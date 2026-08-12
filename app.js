/**
 * LifeTracker - 生活管家
 * 离线优先，数据存储于 IndexedDB
 */

// ==================== 数据库封装 ====================
const DB_NAME = 'LifeTrackerDB';
const DB_VERSION = 2;

const TABLES = {
    COURSES: 'courses',
    TRANSACTIONS: 'transactions',
    DIARIES: 'diaries',
    HABITS: 'habits',
    HABIT_LOGS: 'habitLogs',
    SLEEP: 'sleep'
};

let db = null;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains(TABLES.COURSES)) {
                database.createObjectStore(TABLES.COURSES, { keyPath: 'id', autoIncrement: true });
            }
            if (!database.objectStoreNames.contains(TABLES.TRANSACTIONS)) {
                const ts = database.createObjectStore(TABLES.TRANSACTIONS, { keyPath: 'id', autoIncrement: true });
                ts.createIndex('date', 'date', { unique: false });
            }
            if (!database.objectStoreNames.contains(TABLES.DIARIES)) {
                const ds = database.createObjectStore(TABLES.DIARIES, { keyPath: 'id', autoIncrement: true });
                ds.createIndex('date', 'date', { unique: false });
            }
            // v2 新增表
            if (!database.objectStoreNames.contains(TABLES.HABITS)) {
                database.createObjectStore(TABLES.HABITS, { keyPath: 'id', autoIncrement: true });
            }
            if (!database.objectStoreNames.contains(TABLES.HABIT_LOGS)) {
                const hl = database.createObjectStore(TABLES.HABIT_LOGS, { keyPath: 'id', autoIncrement: true });
                hl.createIndex('habitId', 'habitId', { unique: false });
                hl.createIndex('date', 'date', { unique: false });
            }
            if (!database.objectStoreNames.contains(TABLES.SLEEP)) {
                const sl = database.createObjectStore(TABLES.SLEEP, { keyPath: 'id', autoIncrement: true });
                sl.createIndex('date', 'date', { unique: false });
            }
        };
    });
}

function getStore(table, mode = 'readonly') {
    const tx = db.transaction(table, mode);
    return tx.objectStore(table);
}

function dbAdd(table, data) {
    return new Promise((resolve, reject) => {
        const store = getStore(table, 'readwrite');
        const req = store.add(data);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbPut(table, data) {
    return new Promise((resolve, reject) => {
        const store = getStore(table, 'readwrite');
        const req = store.put(data);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbRemove(table, id) {
    return new Promise((resolve, reject) => {
        const store = getStore(table, 'readwrite');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

function getAll(table) {
    return new Promise((resolve, reject) => {
        const store = getStore(table);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function getById(table, id) {
    return new Promise((resolve, reject) => {
        const store = getStore(table);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function add(table, data, skipSync = false) {
    const id = await dbAdd(table, data);
    if (!skipSync) await pushToCloud(table, id, { ...data, id }, false);
    return id;
}

async function put(table, data, skipSync = false) {
    const id = await dbPut(table, data);
    if (!skipSync) await pushToCloud(table, data.id, data, false);
    return id;
}

async function remove(table, id, skipSync = false) {
    await dbRemove(table, id);
    if (!skipSync) await pushToCloud(table, id, {}, true);
    return id;
}

// ==================== 工具函数 ====================
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const MOOD_EMOJI = { happy: '😊', calm: '😌', tired: '😴', excited: '🤩', sad: '😢', angry: '😠' };
const CATEGORY_EMOJI = { '餐饮': '🍔', '交通': '🚗', '购物': '🛍️', '娱乐': '🎮', '学习': '📚', '住宿': '🏠', '医疗': '💊', '其他': '📦' };

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const w = DAYS[(d.getDay() + 6) % 7];
    return `${m}月${day}日 ${w}`;
}

function todayStr() {
    return new Date().toISOString().split('T')[0];
}

function timeToMin(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

function formatMoney(n) {
    return '¥' + Number(n).toFixed(2);
}

// ==================== 照片工具 ====================
function compressImage(file, maxWidth = 800, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let w = img.width, h = img.height;
            if (w > maxWidth) {
                h = Math.round(h * (maxWidth / w));
                w = maxWidth;
            }
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            resolve(dataUrl);
            URL.revokeObjectURL(img.src);
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

async function previewDiaryPhotos(event) {
    const files = event.target.files;
    const preview = document.getElementById('photoPreview');
    const existingCount = preview.querySelectorAll('img').length;
    const maxPhotos = 3;

    for (let i = 0; i < files.length && existingCount + i < maxPhotos; i++) {
        const file = files[i];
        if (!file.type.startsWith('image/')) continue;
        try {
            const compressed = await compressImage(file, 800, 0.7);
            const div = document.createElement('div');
            div.className = 'photo-item';
            div.innerHTML = `<img src="${compressed}"><button type="button" class="remove-photo" onclick="this.parentElement.remove()">×</button>`;
            preview.appendChild(div);
        } catch (e) {
            console.error('Compress error:', e);
        }
    }
    event.target.value = '';
}

function viewPhoto(src) {
    const overlay = document.createElement('div');
    overlay.className = 'photo-viewer';
    overlay.innerHTML = `<img src="${src}" alt="照片">`;
    overlay.onclick = () => overlay.remove();
    document.body.appendChild(overlay);
}

// ==================== 通用 UI ====================
function switchModule(name) {
    document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const map = { schedule: 'scheduleModule', finance: 'financeModule', diary: 'diaryModule', habit: 'habitModule', sleep: 'sleepModule' };
    document.getElementById(map[name]).classList.add('active');
    document.querySelector(`.nav-item[data-module="${name}"]`).classList.add('active');

    // 刷新数据
    if (name === 'schedule') renderSchedule();
    if (name === 'finance') renderFinance();
    if (name === 'diary') renderDiary();
    if (name === 'habit') renderHabits();
    if (name === 'sleep') renderSleep();
}

function openModal(id) {
    document.getElementById(id).classList.add('active');
    document.body.style.overflow = 'hidden';
    if (id === 'wheelModal') setTimeout(drawWheel, 100);
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
    document.body.style.overflow = '';
    // 清空表单
    const form = document.querySelector(`#${id} form`);
    if (form) {
        form.reset();
        form.querySelectorAll('input[type="hidden"]').forEach(h => h.value = '');
    }
    // 清空照片预览
    const photoPreview = document.getElementById('photoPreview');
    if (photoPreview) photoPreview.innerHTML = '';
}

// 点击模态框背景关闭
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal') && e.target.classList.contains('active')) {
        closeModal(e.target.id);
    }
});

function updateTodayDate() {
    const d = new Date();
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const w = DAYS[(d.getDay() + 6) % 7];
    document.getElementById('dateToday').textContent = `${y}年${m}月${day}日 ${w}`;
}

// ==================== 课表模块 ====================
// 九节课固定时间：45分钟/节，课间休息按规则
const PERIODS = [
    { num: 1, start: '08:00', end: '08:45' },
    { num: 2, start: '08:50', end: '09:35' },
    { num: 3, start: '09:55', end: '10:40' },
    { num: 4, start: '10:45', end: '11:30' },
    { num: 5, start: '11:35', end: '12:20' },
    { num: 6, start: '13:15', end: '14:00' },
    { num: 7, start: '14:05', end: '14:50' },
    { num: 8, start: '15:05', end: '15:50' },
    { num: 9, start: '15:55', end: '16:40' },
];

const SLOT_HEIGHT = 56; // 每节课行高

async function renderSchedule() {
    const courses = await getAll(TABLES.COURSES);
    const today = (new Date().getDay() + 6) % 7;
    const grid = document.getElementById('scheduleGrid');

    let html = '';

    // 表头：空单元格 + 周一到周日
    html += `<div class="schedule-header"></div>`;
    DAYS.forEach((day, i) => {
        html += `<div class="schedule-header ${i === today ? 'today' : ''}">${day}</div>`;
    });

    // 九节课行
    PERIODS.forEach(p => {
        html += `<div class="time-slot"><span>第${p.num}节<br><small>${p.start}-${p.end}</small></span></div>`;
        for (let d = 0; d < 7; d++) {
            html += `<div class="course-cell" data-day="${d}" data-period="${p.num}"></div>`;
        }
    });

    grid.innerHTML = html;

    // 放置课程卡片（支持跨多节）
    courses.forEach(course => {
        const startIdx = PERIODS.findIndex(p => p.start === course.startTime);
        const endIdx = PERIODS.findIndex(p => p.end === course.endTime);
        if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return;

        const startPeriod = PERIODS[startIdx];
        const span = endIdx - startIdx + 1; // 跨越几行

        const cell = grid.querySelector(`.course-cell[data-day="${course.day}"][data-period="${startPeriod.num}"]`);
        if (!cell) return;

        const card = document.createElement('div');
        card.className = `course-card course-${course.color || 'indigo'}`;
        card.style.top = '2px';
        card.style.height = `${span * SLOT_HEIGHT - 4}px`;
        card.innerHTML = `
            <span class="name">${escapeHtml(course.name)}</span>
            <span class="meta">${course.location || ''} · ${course.startTime}-${course.endTime}</span>
        `;
        card.onclick = (e) => {
            e.stopPropagation();
            editCourse(course.id);
        };
        cell.appendChild(card);
    });
}

async function saveCourse(e) {
    e.preventDefault();
    const id = document.getElementById('courseId').value;
    const periodNum = parseInt(document.getElementById('coursePeriod').value);
    const duration = parseInt(document.getElementById('courseDuration').value);

    const startIdx = PERIODS.findIndex(p => p.num === periodNum);
    if (startIdx === -1) return;

    // 计算结束节次（不能超过第9节）
    let endIdx = startIdx + duration - 1;
    if (endIdx >= PERIODS.length) endIdx = PERIODS.length - 1;

    const startPeriod = PERIODS[startIdx];
    const endPeriod = PERIODS[endIdx];

    const data = {
        name: document.getElementById('courseName').value.trim(),
        day: parseInt(document.getElementById('courseDay').value),
        startTime: startPeriod.start,
        endTime: endPeriod.end,
        location: document.getElementById('courseLocation').value.trim(),
        teacher: document.getElementById('courseTeacher').value.trim(),
        color: document.getElementById('courseColor').value
    };

    if (id) {
        data.id = parseInt(id);
        await put(TABLES.COURSES, data);
    } else {
        await add(TABLES.COURSES, data);
    }

    closeModal('courseModal');
    renderSchedule();
}

async function editCourse(id) {
    const course = await getById(TABLES.COURSES, id);
    if (!course) return;

    const startIdx = PERIODS.findIndex(p => p.start === course.startTime);
    const endIdx = PERIODS.findIndex(p => p.end === course.endTime);
    const duration = (startIdx !== -1 && endIdx !== -1) ? (endIdx - startIdx + 1) : 1;

    document.getElementById('courseId').value = course.id;
    document.getElementById('courseName').value = course.name;
    document.getElementById('courseDay').value = course.day;
    document.getElementById('coursePeriod').value = startIdx !== -1 ? PERIODS[startIdx].num : 1;
    document.getElementById('courseDuration').value = duration;
    document.getElementById('courseLocation').value = course.location || '';
    document.getElementById('courseTeacher').value = course.teacher || '';
    document.getElementById('courseColor').value = course.color || 'indigo';

    openModal('courseModal');
}

async function deleteCourse(id) {
    if (!confirm('确定删除这门课程吗？')) return;
    await remove(TABLES.COURSES, id);
    renderSchedule();
}

// ==================== 记账模块 ====================
async function renderFinance() {
    let list = await getAll(TABLES.TRANSACTIONS);

    // 计算本月统计
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    let income = 0, expense = 0;

    list.forEach(t => {
        const d = new Date(t.date);
        if (d.getFullYear() === y && d.getMonth() === m) {
            if (t.type === 'income') income += parseFloat(t.amount);
            else expense += parseFloat(t.amount);
        }
    });

    animateMoney(document.getElementById('monthIncome'), income);
    animateMoney(document.getElementById('monthExpense'), expense);
    animateMoney(document.getElementById('monthBalance'), income - expense);

    // 计算累计余额（按日期从早到晚）
    const sortedAsc = [...list].sort((a, b) => new Date(a.date) - new Date(b.date));
    let runningBalance = 0;
    const balanceMap = new Map(); // id -> 该笔交易后的余额

    sortedAsc.forEach(t => {
        if (t.type === 'income') runningBalance += parseFloat(t.amount);
        else runningBalance -= parseFloat(t.amount);
        balanceMap.set(t.id, runningBalance);
    });

    animateMoney(document.getElementById('totalBalance'), runningBalance);

    // 按日期倒序显示
    list.sort((a, b) => new Date(b.date) - new Date(a.date));

    const container = document.getElementById('financeList');
    if (list.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="emoji">💰</span>
                <div>还没有记账记录，点击右上角开始记账吧</div>
            </div>
        `;
        return;
    }

    container.innerHTML = list.map(t => {
        const bal = balanceMap.get(t.id);
        return `
            <div class="finance-item ${t.type}" onclick="editFinance(${t.id})" data-id="${t.id}">
                <div class="finance-icon">${CATEGORY_EMOJI[t.category] || '📦'}</div>
                <div class="finance-info">
                    <div class="category">${escapeHtml(t.category)} ${t.note ? '· ' + escapeHtml(t.note) : ''}</div>
                    <div class="note">${formatDate(t.date)}</div>
                </div>
                <div class="finance-right">
                    <div class="finance-amount">${t.type === 'income' ? '+' : '-'}${formatMoney(t.amount).replace('¥', '')}</div>
                    <div class="finance-balance">余 ${formatMoney(bal).replace('¥', '')}</div>
                </div>
                <button class="btn-icon" onclick="event.stopPropagation(); deleteFinance(${t.id})">🗑️</button>
            </div>
        `;
    }).join('');
}

async function saveFinance(e) {
    e.preventDefault();
    const id = document.getElementById('financeId').value;
    const data = {
        type: document.getElementById('financeType').value,
        amount: parseFloat(document.getElementById('financeAmount').value),
        category: document.getElementById('financeCategory').value,
        date: document.getElementById('financeDate').value,
        note: document.getElementById('financeNote').value.trim()
    };

    if (id) {
        data.id = parseInt(id);
        await put(TABLES.TRANSACTIONS, data);
    } else {
        await add(TABLES.TRANSACTIONS, data);
    }

    closeModal('financeModal');
    renderFinance();
}

async function editFinance(id) {
    const t = await getById(TABLES.TRANSACTIONS, id);
    if (!t) return;

    document.getElementById('financeId').value = t.id;
    document.getElementById('financeType').value = t.type;
    document.getElementById('financeAmount').value = t.amount;
    document.getElementById('financeCategory').value = t.category;
    document.getElementById('financeDate').value = t.date;
    document.getElementById('financeNote').value = t.note || '';

    openModal('financeModal');
}

async function deleteFinance(id) {
    if (!confirm('确定删除这条记录吗？')) return;
    await remove(TABLES.TRANSACTIONS, id);
    renderFinance();
}

// ==================== 日记模块 ====================
async function renderDiary() {
    const list = await getAll(TABLES.DIARIES);
    list.sort((a, b) => new Date(b.date) - new Date(a.date));

    const container = document.getElementById('diaryTimeline');
    if (list.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="emoji">📝</span>
                <div>还没有日记，点击右上角记录今天吧</div>
            </div>
        `;
        return;
    }

    container.innerHTML = list.map(d => {
        const tags = Array.isArray(d.tags) ? d.tags : (d.tags || '').split(/\s+/).filter(Boolean);
        const photos = d.photos || [];
        return `
            <div class="diary-card mood-${d.mood}" onclick="editDiary(${d.id})">
                <div class="diary-header">
                    <span class="diary-date">${formatDate(d.date)}</span>
                    <span class="diary-mood">${MOOD_EMOJI[d.mood] || ''}</span>
                </div>
                <div class="diary-content">${escapeHtml(d.content)}</div>
                ${photos.length ? `
                    <div class="diary-photos">
                        ${photos.map(src => `<img src="${src}" onclick="event.stopPropagation(); viewPhoto('${src}')">`).join('')}
                    </div>
                ` : ''}
                <div class="diary-ai-feedback" id="aiFeedback_${d.id}">
                    <button onclick="event.stopPropagation(); loadDiaryFeedback(${d.id})">🤖 获取 AI 反馈</button>
                </div>
                ${tags.length ? `
                    <div class="diary-tags">
                        ${tags.map(t => `<span class="diary-tag">${escapeHtml(t)}</span>`).join('')}
                    </div>
                ` : ''}
                <div class="diary-actions">
                    <button class="btn-icon" onclick="event.stopPropagation(); deleteDiary(${d.id})">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

async function saveDiary(e) {
    e.preventDefault();
    const id = document.getElementById('diaryId').value;
    const tagsStr = document.getElementById('diaryTags').value.trim();

    // 收集照片
    const photoImgs = document.querySelectorAll('#photoPreview img');
    const photos = Array.from(photoImgs).map(img => img.src);

    const data = {
        date: document.getElementById('diaryDate').value,
        content: document.getElementById('diaryContent').value.trim(),
        mood: document.getElementById('diaryMood').value,
        tags: tagsStr ? tagsStr.split(/\s+/).filter(Boolean) : [],
        photos: photos,
        createdAt: new Date().toISOString()
    };

    if (id) {
        const old = await getById(TABLES.DIARIES, parseInt(id));
        data.id = parseInt(id);
        data.createdAt = old?.createdAt || data.createdAt;
        await put(TABLES.DIARIES, data);
    } else {
        await add(TABLES.DIARIES, data);
    }

    closeModal('diaryModal');
    renderDiary();
}

async function editDiary(id) {
    const d = await getById(TABLES.DIARIES, id);
    if (!d) return;

    document.getElementById('diaryId').value = d.id;
    document.getElementById('diaryDate').value = d.date;
    document.getElementById('diaryContent').value = d.content;
    document.getElementById('diaryMood').value = d.mood;
    document.getElementById('diaryTags').value = Array.isArray(d.tags) ? d.tags.join(' ') : (d.tags || '');

    // 回显照片
    const preview = document.getElementById('photoPreview');
    preview.innerHTML = '';
    if (d.photos && d.photos.length) {
        d.photos.forEach(src => {
            const div = document.createElement('div');
            div.className = 'photo-item';
            div.innerHTML = `<img src="${src}"><button type="button" class="remove-photo" onclick="this.parentElement.remove()">×</button>`;
            preview.appendChild(div);
        });
    }

    openModal('diaryModal');
}

async function deleteDiary(id) {
    if (!confirm('确定删除这篇日记吗？')) return;
    await remove(TABLES.DIARIES, id);
    renderDiary();
}

// ==================== 习惯打卡模块 ====================
function getWeekDays() {
    const days = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        days.push(d.toISOString().split('T')[0]);
    }
    return days;
}

function calculateStreak(habitId, logs) {
    const habitLogs = logs.filter(l => l.habitId === habitId).map(l => l.date).sort().reverse();
    if (habitLogs.length === 0) return 0;
    let streak = 0;
    const today = new Date(todayStr());
    let checkDate = new Date(today);
    if (!habitLogs.includes(todayStr())) {
        checkDate.setDate(checkDate.getDate() - 1);
    }
    while (true) {
        const dateStr = checkDate.toISOString().split('T')[0];
        if (habitLogs.includes(dateStr)) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
        } else {
            break;
        }
    }
    return streak;
}

async function renderHabits() {
    const habits = await getAll(TABLES.HABITS);
    const logs = await getAll(TABLES.HABIT_LOGS);
    const today = todayStr();
    const weekDays = getWeekDays();
    const container = document.getElementById('habitList');
    const summary = document.getElementById('habitSummary');

    const todayLogs = new Set(logs.filter(l => l.date === today).map(l => l.habitId));
    const completedToday = habits.filter(h => todayLogs.has(h.id)).length;

    summary.innerHTML = `
        <div class="summary-card">
            <span class="label">今日打卡</span>
            <span class="amount">${completedToday}/${habits.length}</span>
        </div>
    `;

    if (habits.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="emoji">✅</span>
                <div>还没有习惯，点击右上角添加吧</div>
            </div>
        `;
        return;
    }

    container.innerHTML = habits.map((h, idx) => {
        const isDone = todayLogs.has(h.id);
        const streak = calculateStreak(h.id, logs);
        const weekStatus = weekDays.map(d => {
            const done = logs.some(l => l.habitId === h.id && l.date === d);
            return `<div class="habit-dot ${done ? 'done' : ''}"></div>`;
        }).join('');
        const colorMap = {
            indigo: '#4f46e5', rose: '#e11d48', emerald: '#059669',
            amber: '#d97706', sky: '#0284c7', violet: '#7c3aed'
        };
        const color = colorMap[h.color] || colorMap.indigo;

        return `
            <div class="habit-card ${isDone ? 'completed' : ''}" style="--habit-color:${color}">
                <div class="habit-main" onclick="toggleHabit(${h.id})">
                    <span class="habit-icon">${h.icon || '✨'}</span>
                    <div class="habit-info">
                        <div class="habit-name">${escapeHtml(h.name)}</div>
                        <div class="habit-streak">${streak > 0 ? '🔥 连续 ' + streak + ' 天' : '还没开始'}</div>
                    </div>
                    <div class="habit-check">${isDone ? '✓' : ''}</div>
                </div>
                <div class="habit-week">${weekStatus}</div>
                <div class="habit-actions">
                    <button class="btn-icon" onclick="event.stopPropagation(); editHabit(${h.id})">✏️</button>
                    <button class="btn-icon" onclick="event.stopPropagation(); deleteHabit(${h.id})">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

async function toggleHabit(habitId) {
    const today = todayStr();
    const logs = await getAll(TABLES.HABIT_LOGS);
    const existing = logs.find(l => l.habitId === habitId && l.date === today);
    if (existing) {
        await remove(TABLES.HABIT_LOGS, existing.id);
    } else {
        await add(TABLES.HABIT_LOGS, { habitId, date: today });
    }
    renderHabits();
}

async function saveHabit(e) {
    e.preventDefault();
    const id = document.getElementById('habitId').value;
    const data = {
        name: document.getElementById('habitName').value.trim(),
        icon: document.getElementById('habitIcon').value,
        color: document.getElementById('habitColor').value
    };
    if (id) {
        data.id = parseInt(id);
        await put(TABLES.HABITS, data);
    } else {
        await add(TABLES.HABITS, data);
    }
    closeModal('habitModal');
    renderHabits();
}

async function editHabit(id) {
    const h = await getById(TABLES.HABITS, id);
    if (!h) return;
    document.getElementById('habitId').value = h.id;
    document.getElementById('habitName').value = h.name;
    document.getElementById('habitIcon').value = h.icon || '✨';
    document.getElementById('habitColor').value = h.color || 'indigo';
    openModal('habitModal');
}

async function deleteHabit(id) {
    if (!confirm('确定删除这个习惯吗？相关打卡记录也会一起删除。')) return;
    await remove(TABLES.HABITS, id);
    const logs = await getAll(TABLES.HABIT_LOGS);
    for (const log of logs.filter(l => l.habitId === id)) {
        await dbRemove(TABLES.HABIT_LOGS, log.id);
    }
    renderHabits();
}

// ==================== 睡眠记录模块 ====================
function calculateSleepHours(bed, wake) {
    const [bh, bm] = bed.split(':').map(Number);
    const [wh, wm] = wake.split(':').map(Number);
    let start = bh * 60 + bm;
    let end = wh * 60 + wm;
    if (end < start) end += 24 * 60;
    return (end - start) / 60;
}

function formatSleepDuration(hours) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}小时${m > 0 ? m + '分' : ''}`;
}

async function renderSleep() {
    const list = await getAll(TABLES.SLEEP);
    list.sort((a, b) => new Date(b.date) - new Date(a.date));

    const summary = document.getElementById('sleepSummary');
    const container = document.getElementById('sleepList');

    const avgHours = list.length
        ? (list.reduce((sum, s) => sum + calculateSleepHours(s.bedTime, s.wakeTime), 0) / list.length).toFixed(1)
        : 0;
    const qualityEmoji = { 5: '😴', 4: '😊', 3: '😐', 2: '😵', 1: '💀' };

    summary.innerHTML = `
        <div class="summary-card">
            <span class="label">平均睡眠</span>
            <span class="amount">${avgHours}h</span>
        </div>
        <div class="summary-card">
            <span class="label">记录天数</span>
            <span class="amount">${list.length}天</span>
        </div>
    `;

    if (list.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="emoji">🌙</span>
                <div>还没有睡眠记录，点击右上角记录昨晚的睡眠吧</div>
            </div>
        `;
        return;
    }

    container.innerHTML = list.map((s, idx) => {
        const hours = calculateSleepHours(s.bedTime, s.wakeTime);
        return `
            <div class="sleep-item" onclick="editSleep(${s.id})">
                <div class="sleep-left">
                    <div class="sleep-date">${formatDate(s.date)}</div>
                    <div class="sleep-time">${s.bedTime} → ${s.wakeTime}</div>
                    <div class="sleep-note">${escapeHtml(s.note || '')}</div>
                </div>
                <div class="sleep-right">
                    <div class="sleep-duration">${formatSleepDuration(hours)}</div>
                    <div class="sleep-quality">${qualityEmoji[s.quality] || '😐'} ${s.quality}分</div>
                </div>
                <button class="btn-icon" onclick="event.stopPropagation(); deleteSleep(${s.id})">🗑️</button>
            </div>
        `;
    }).join('');
}

async function saveSleep(e) {
    e.preventDefault();
    const id = document.getElementById('sleepId').value;
    const data = {
        date: document.getElementById('sleepDate').value,
        bedTime: document.getElementById('sleepBedTime').value,
        wakeTime: document.getElementById('sleepWakeTime').value,
        quality: parseInt(document.getElementById('sleepQuality').value),
        note: document.getElementById('sleepNote').value.trim()
    };
    if (id) {
        data.id = parseInt(id);
        await put(TABLES.SLEEP, data);
    } else {
        await add(TABLES.SLEEP, data);
    }
    closeModal('sleepModal');
    renderSleep();
}

async function editSleep(id) {
    const s = await getById(TABLES.SLEEP, id);
    if (!s) return;
    document.getElementById('sleepId').value = s.id;
    document.getElementById('sleepDate').value = s.date;
    document.getElementById('sleepBedTime').value = s.bedTime;
    document.getElementById('sleepWakeTime').value = s.wakeTime;
    document.getElementById('sleepQuality').value = s.quality;
    document.getElementById('sleepNote').value = s.note || '';
    openModal('sleepModal');
}

async function deleteSleep(id) {
    if (!confirm('确定删除这条睡眠记录吗？')) return;
    await remove(TABLES.SLEEP, id);
    renderSleep();
}

// ==================== 数据导出导入 ====================
async function exportData() {
    const data = {};
    for (const key of Object.keys(TABLES)) {
        data[TABLES[key]] = await getAll(TABLES[key]);
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lifetracker-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

async function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!confirm('导入将覆盖所有现有数据，确定继续？')) return;

        for (const key of Object.keys(TABLES)) {
            const table = TABLES[key];
            const items = await getAll(table);
            for (const item of items) {
                await dbRemove(table, item.id);
            }
            for (const item of (data[table] || [])) {
                delete item.id;
                await dbAdd(table, item);
            }
        }
        alert('导入成功！页面即将刷新。');
        location.reload();
    } catch (e) {
        alert('导入失败：' + e.message);
    }
    event.target.value = '';
}

async function clearAllData() {
    if (!confirm('⚠️ 确定清空所有数据吗？此操作不可恢复！')) return;
    if (!confirm('再次确认：你真的要删除所有课表、记账、日记、打卡、睡眠记录吗？')) return;
    for (const key of Object.keys(TABLES)) {
        const items = await getAll(TABLES[key]);
        for (const item of items) {
            await dbRemove(TABLES[key], item.id);
        }
    }
    alert('已清空所有数据。');
    location.reload();
}

// ==================== AI 助手（Gemini）====================
const AI_MODEL = 'glm-4-flash';
const AI_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

function saveGeminiKey() {
    const key = document.getElementById('geminiKeyInput').value.trim();
    if (key) {
        localStorage.setItem('gemini_key', key);
    } else {
        localStorage.removeItem('gemini_key');
    }
}

function getGeminiKey() {
    return localStorage.getItem('gemini_key') || '';
}

async function callAI(messages) {
    const key = getGeminiKey();
    if (!key) return '请先设置 API Key（点击右上角 ⚙️）';

    try {
        const res = await fetch(AI_BASE_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: AI_MODEL,
                messages: messages,
                temperature: 0.7,
                max_tokens: 256
            })
        });
        const data = await res.json();
        if (data.error) return `AI 出错：${data.error.message}`;
        return data.choices?.[0]?.message?.content || 'AI 没有回答';
    } catch (e) {
        return 'AI 请求失败，请检查网络或 API Key';
    }
}

async function getDiaryFeedback(content) {
    const messages = [
        { role: 'system', content: '你是一个温暖、理解力强的心理陪伴助手。用户写了一篇日记，请用中文给一句简短（30-50字）、温暖、走心的反馈，像朋友一样说话。不要分析，不要建议，只是理解和陪伴。' },
        { role: 'user', content: `日记内容：${content}` }
    ];
    return await callAI(messages);
}

async function loadDiaryFeedback(id) {
    const container = document.getElementById(`aiFeedback_${id}`);
    if (!container) return;
    container.innerHTML = '<span class="ai-loading">🤖 思考中...</span>';
    const d = await getById(TABLES.DIARIES, id);
    if (!d) {
        container.innerHTML = '';
        return;
    }
    const feedback = await getDiaryFeedback(d.content);
    container.innerHTML = `<span class="ai-text">🤖 ${escapeHtml(feedback)}</span>`;
}

async function sendAIQuestion() {
    const input = document.getElementById('aiInput');
    const chat = document.getElementById('aiChat');
    const question = input.value.trim();
    if (!question) return;

    // 显示用户消息
    const userBubble = document.createElement('div');
    userBubble.className = 'ai-bubble ai-user';
    userBubble.textContent = question;
    chat.appendChild(userBubble);
    input.value = '';
    chat.scrollTop = chat.scrollHeight;

    // 准备上下文数据（最近7天）
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const [transactions, diaries, habits, habitLogs, sleepRecords] = await Promise.all([
        getAll(TABLES.TRANSACTIONS),
        getAll(TABLES.DIARIES),
        getAll(TABLES.HABITS),
        getAll(TABLES.HABIT_LOGS),
        getAll(TABLES.SLEEP)
    ]);
    const recentData = {
        transactions: transactions.filter(t => new Date(t.date) >= cutoff),
        diaries: diaries.filter(d => new Date(d.date) >= cutoff),
        habits: habits,
        habitLogs: habitLogs.filter(h => new Date(h.date) >= cutoff),
        sleep: sleepRecords.filter(s => new Date(s.date) >= cutoff)
    };

    // 显示加载中
    const loadingBubble = document.createElement('div');
    loadingBubble.className = 'ai-bubble ai-bot';
    loadingBubble.innerHTML = '<span class="ai-loading">🤖 思考中...</span>';
    chat.appendChild(loadingBubble);
    chat.scrollTop = chat.scrollHeight;

    const messages = [
        { role: 'system', content: '你是一个生活数据助手，名字叫"小管家"。基于用户的真实数据回答问题，语气亲切像朋友。如果数据不足就诚实说。' },
        { role: 'user', content: `用户最近7天数据（JSON格式）：${JSON.stringify(recentData, null, 2)}\n\n用户问题：${question}` }
    ];

    const answer = await callAI(messages);
    loadingBubble.innerHTML = escapeHtml(answer).replace(/\n/g, '<br>');
    chat.scrollTop = chat.scrollHeight;
}

// ==================== 云端同步 ====================
const SUPABASE_URL = 'https://irovkiusdexjstsnzljv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlyb3ZraXVzZGV4anN0c256bGp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1MDg3MTYsImV4cCI6MjEwMjA4NDcxNn0.xUV5tdrSv_1s24mYcGnXxPyzkJ74gX7iWfXpmjnqlxg';

let deviceId = localStorage.getItem('lt_device_id');
if (!deviceId) {
    deviceId = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    localStorage.setItem('lt_device_id', deviceId);
}

let supabaseClient = null;

async function initSync() {
    if (!window.supabase) {
        console.warn('Supabase SDK not loaded');
        return;
    }
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // 启动时拉取云端最新数据
    await pullFromCloud();

    // 把本地历史数据全量推送到云端（旧数据备份）
    await pushLocalToCloud();

    // 订阅实时变更
    supabaseClient
        .channel('sync_changes')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'sync_data'
        }, payload => {
            handleRemoteChange(payload.new);
        })
        .subscribe();
}

async function pushToCloud(tableName, recordId, payload, deleted = false) {
    if (!supabaseClient) return;
    try {
        const row = {
            device_id: deviceId,
            table_name: tableName,
            record_id: recordId,
            payload: payload || {},
            updated_at: new Date().toISOString(),
            deleted: deleted
        };

        // 先查询是否已有记录
        const { data: existing } = await supabaseClient
            .from('sync_data')
            .select('id')
            .eq('device_id', deviceId)
            .eq('table_name', tableName)
            .eq('record_id', recordId)
            .maybeSingle();

        if (existing) {
            await supabaseClient.from('sync_data').update(row).eq('id', existing.id);
        } else {
            await supabaseClient.from('sync_data').insert(row);
        }
    } catch (e) {
        console.error('Push exception:', e);
    }
}

async function pushLocalToCloud() {
    if (!supabaseClient) return;
    const tables = [TABLES.COURSES, TABLES.TRANSACTIONS, TABLES.DIARIES, TABLES.HABITS, TABLES.HABIT_LOGS, TABLES.SLEEP];
    for (const table of tables) {
        try {
            const items = await getAll(table);
            for (const item of items) {
                if (!item || !item.id) continue;
                await pushToCloud(table, item.id, item, false);
            }
        } catch (e) {
            console.error('Push local error:', e);
        }
    }
}

async function pullFromCloud() {
    if (!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient
            .from('sync_data')
            .select('*')
            .order('updated_at', { ascending: true });

        if (error) {
            console.error('Pull error:', error);
            return;
        }

        // 按 table_name + record_id 去重，取最新
        const latestMap = new Map();
        for (const row of (data || [])) {
            const key = `${row.table_name}:${row.record_id}`;
            if (!latestMap.has(key) || new Date(row.updated_at) > new Date(latestMap.get(key).updated_at)) {
                latestMap.set(key, row);
            }
        }

        for (const row of latestMap.values()) {
            if (row.device_id === deviceId) continue; // 自己设备的数据本地已有

            if (row.deleted) {
                await remove(row.table_name, row.record_id, true);
            } else {
                const existing = await getById(row.table_name, row.record_id);
                const remoteTime = new Date(row.updated_at).getTime();
                const localTime = existing ? new Date(existing.updatedAt || existing.createdAt || 0).getTime() : 0;

                if (!existing || remoteTime >= localTime) {
                    await put(row.table_name, { ...row.payload, id: row.record_id }, true);
                }
            }
        }

        // 刷新当前显示的模块
        const active = document.querySelector('.module.active');
        if (active) {
            if (active.id === 'scheduleModule') await renderSchedule();
            if (active.id === 'financeModule') await renderFinance();
            if (active.id === 'diaryModule') await renderDiary();
        }
    } catch (e) {
        console.error('Pull exception:', e);
    }
}

async function handleRemoteChange(row) {
    if (!row || row.device_id === deviceId) return;

    // 重新查询该 key 的最新记录（避免收到旧事件的覆盖）
    const { data } = await supabaseClient
        .from('sync_data')
        .select('*')
        .eq('table_name', row.table_name)
        .eq('record_id', row.record_id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

    const latest = data || row;

    if (latest.deleted) {
        await remove(latest.table_name, latest.record_id, true);
    } else {
        const existing = await getById(latest.table_name, latest.record_id);
        const remoteTime = new Date(latest.updated_at).getTime();
        const localTime = existing ? new Date(existing.updatedAt || existing.createdAt || 0).getTime() : 0;

        if (!existing || remoteTime >= localTime) {
            await put(latest.table_name, { ...latest.payload, id: latest.record_id }, true);
        }
    }

    // 刷新当前显示的模块
    const active = document.querySelector('.module.active');
    if (active) {
        if (active.id === 'scheduleModule') await renderSchedule();
        if (active.id === 'financeModule') await renderFinance();
        if (active.id === 'diaryModule') await renderDiary();
    }
}

// ==================== 辅助函数 ====================
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ==================== 背景管理 ====================
function loadBackground() {
    const bgLayer = document.getElementById('bgLayer');
    const saved = localStorage.getItem('lt_bg_image');
    if (saved && bgLayer) {
        bgLayer.style.backgroundImage = `url(${saved})`;
        bgLayer.classList.add('has-image');
    }
}

function changeBackground(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        localStorage.setItem('lt_bg_image', dataUrl);
        loadBackground();
    };
    reader.readAsDataURL(file);
}

function resetBackground() {
    localStorage.removeItem('lt_bg_image');
    const bgLayer = document.getElementById('bgLayer');
    if (bgLayer) {
        bgLayer.style.backgroundImage = '';
        bgLayer.classList.remove('has-image');
    }
    const input = document.getElementById('bgImageInput');
    if (input) input.value = '';
}

// ==================== 主题换肤 ====================
const THEMES = {
    default: {
        primary: '#4f46e5',
        primaryLight: '#6366f1',
        primaryDark: '#4338ca',
        gradient: 'linear-gradient(160deg, #4f46e5 0%, #7c3aed 25%, #db2777 60%, #f59e0b 100%)',
        headerGradient: 'linear-gradient(135deg, rgba(79,70,229,0.95) 0%, rgba(236,72,153,0.9) 100%)'
    },
    mint: {
        primary: '#059669',
        primaryLight: '#10b981',
        primaryDark: '#047857',
        gradient: 'linear-gradient(160deg, #059669 0%, #06b6d4 50%, #3b82f6 100%)',
        headerGradient: 'linear-gradient(135deg, rgba(5,150,105,0.95) 0%, rgba(6,182,212,0.9) 100%)'
    },
    sakura: {
        primary: '#db2777',
        primaryLight: '#ec4899',
        primaryDark: '#be185d',
        gradient: 'linear-gradient(160deg, #f472b6 0%, #fb7185 50%, #fbbf24 100%)',
        headerGradient: 'linear-gradient(135deg, rgba(244,114,182,0.95) 0%, rgba(251,113,133,0.9) 100%)'
    },
    dark: {
        primary: '#7c3aed',
        primaryLight: '#8b5cf6',
        primaryDark: '#6d28d9',
        gradient: 'linear-gradient(160deg, #1e1b4b 0%, #4c1d95 50%, #7c3aed 100%)',
        headerGradient: 'linear-gradient(135deg, rgba(30,27,75,0.95) 0%, rgba(76,29,149,0.9) 100%)'
    },
    sunset: {
        primary: '#d97706',
        primaryLight: '#f59e0b',
        primaryDark: '#b45309',
        gradient: 'linear-gradient(160deg, #f59e0b 0%, #ef4444 50%, #db2777 100%)',
        headerGradient: 'linear-gradient(135deg, rgba(245,158,11,0.95) 0%, rgba(239,68,68,0.9) 100%)'
    }
};

function setTheme(name) {
    const theme = THEMES[name];
    if (!theme) return;
    localStorage.setItem('lt_theme', name);
    applyTheme(theme);
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === name);
    });
}

function applyTheme(theme) {
    const root = document.documentElement;
    root.style.setProperty('--primary', theme.primary);
    root.style.setProperty('--primary-light', theme.primaryLight);
    root.style.setProperty('--primary-dark', theme.primaryDark);

    const bgLayer = document.getElementById('bgLayer');
    if (bgLayer && !bgLayer.classList.contains('has-image')) {
        bgLayer.style.background = theme.gradient;
    }

    const header = document.querySelector('.app-header');
    if (header) header.style.background = theme.headerGradient;
}

function loadTheme() {
    const saved = localStorage.getItem('lt_theme') || 'default';
    const theme = THEMES[saved];
    if (theme) applyTheme(theme);
    const btn = document.querySelector(`.theme-btn[data-theme="${saved}"]`);
    if (btn) {
        document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
}

// ==================== 每日运势签 ====================
function openFortune() {
    loadFortune();
    openModal('fortuneModal');
}

function loadFortune() {
    const saved = localStorage.getItem(`lt_fortune_${todayStr()}`);
    if (saved) {
        renderFortune(JSON.parse(saved));
    } else {
        // 随机生成一个基础版
        const basic = generateBasicFortune();
        renderFortune(basic);
        localStorage.setItem(`lt_fortune_${todayStr()}`, JSON.stringify(basic));
    }
}

function generateBasicFortune() {
    const summaries = [
        '今天是个充满活力的日子，保持积极心态会有好事发生。',
        '适合静下心来整理思绪，给自己一点独处的时间。',
        '能量满满的一天，不妨挑战一件一直想做的事。',
        '今天适合与人交流，可能会遇到志同道合的朋友。',
        '放慢脚步，享受生活中的小确幸，今天适合休息。'
    ];
    const colors = ['红色', '蓝色', '绿色', '黄色', '紫色', '白色'];
    const numbers = ['3', '7', '8', '12', '21', '66'];
    const suitable = ['整理课表', '记账', '给朋友发消息', '早睡', '写日记'];
    const avoid = ['熬夜', '冲动消费', '拖延作业'];
    const quotes = [
        '每一天都是新的开始。',
        '慢慢来，比较快。',
        '做最好的自己，而不是第二个别人。'
    ];
    return {
        summary: summaries[Math.floor(Math.random() * summaries.length)],
        luckyColor: colors[Math.floor(Math.random() * colors.length)],
        luckyNumber: numbers[Math.floor(Math.random() * numbers.length)],
        suitable: suitable.sort(() => 0.5 - Math.random()).slice(0, 3),
        avoid: avoid.sort(() => 0.5 - Math.random()).slice(0, 2),
        quote: quotes[Math.floor(Math.random() * quotes.length)]
    };
}

function renderFortune(data) {
    document.getElementById('fortuneSummary').textContent = data.summary;
    document.getElementById('fortuneColor').textContent = data.luckyColor;
    document.getElementById('fortuneNumber').textContent = data.luckyNumber;
    document.getElementById('fortuneSuitable').innerHTML = data.suitable.map(s => `<li>${s}</li>`).join('');
    document.getElementById('fortuneAvoid').innerHTML = data.avoid.map(a => `<li>${a}</li>`).join('');
    document.getElementById('fortuneQuote').textContent = data.quote ? `💬 "${data.quote}"` : '';
}

async function generateFortuneWithAI() {
    const summaryEl = document.getElementById('fortuneSummary');
    summaryEl.textContent = '🤖 AI 正在为你测算今日运势...';

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 3);
    const [diaries, sleepRecords] = await Promise.all([
        getAll(TABLES.DIARIES),
        getAll(TABLES.SLEEP)
    ]);
    const recentDiaries = diaries.filter(d => new Date(d.date) >= cutoff).map(d => ({
        date: d.date,
        mood: d.mood,
        content: d.content.substring(0, 50)
    }));
    const recentSleep = sleepRecords.filter(s => new Date(s.date) >= cutoff).map(s => ({
        date: s.date,
        quality: s.quality
    }));

    const messages = [
        { role: 'system', content: '你是一个有趣的运势大师，根据用户最近几天的心情和状态，生成一条幽默、接地气的中文每日运势签。请严格返回 JSON 格式，不要加任何其他文字。' },
        { role: 'user', content: `用户最近3天日记（日期+心情+内容摘要）：${JSON.stringify(recentDiaries)}\n用户最近3天睡眠质量（1-5分）：${JSON.stringify(recentSleep)}\n\n请生成 JSON：{"summary":"一句话运势概述（30字以内，幽默风格）","luckyColor":"一个颜色","luckyNumber":"一个数字","suitable":["宜做的3件事"],"avoid":["不宜做的2件事"],"quote":"一句今日语录（20字以内）"}` }
    ];

    try {
        const response = await callAI(messages);
        // 尝试从 AI 响应中提取 JSON
        let jsonStr = response;
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) jsonStr = jsonMatch[0];
        const data = JSON.parse(jsonStr);
        renderFortune(data);
        localStorage.setItem(`lt_fortune_${todayStr()}`, JSON.stringify(data));
    } catch (e) {
        console.error('Fortune AI error:', e);
        const basic = generateBasicFortune();
        renderFortune(basic);
        summaryEl.textContent = basic.summary + '（AI 生成失败，已切换随机版）';
    }
}

// ==================== 决策转盘 ====================
const WHEEL_COLORS = ['#4f46e5', '#ec4899', '#f59e0b', '#10b981', '#8b5cf6', '#06b6d4', '#ef4444', '#3b82f6'];

function getWheelOptions() {
    return Array.from(document.querySelectorAll('.wheel-input'))
        .map(i => i.value.trim())
        .filter(Boolean);
}

function drawWheel(rotation = 0) {
    const canvas = document.getElementById('wheelCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const options = getWheelOptions();
    if (options.length === 0) return;

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = Math.min(cx, cy) - 8;
    const sliceAngle = (2 * Math.PI) / options.length;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < options.length; i++) {
        const start = rotation + i * sliceAngle;
        const end = rotation + (i + 1) * sliceAngle;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, start, end);
        ctx.closePath();
        ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.stroke();

        const textAngle = start + sliceAngle / 2;
        const tx = cx + Math.cos(textAngle) * (radius * 0.6);
        const ty = cy + Math.sin(textAngle) * (radius * 0.6);
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(textAngle + Math.PI / 2);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(options[i].substring(0, 4), 0, 0);
        ctx.restore();
    }

    // 中心圆
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, 2 * Math.PI);
    ctx.fillStyle = 'white';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.stroke();

    // 指针
    ctx.beginPath();
    ctx.moveTo(cx + radius - 2, cy - 10);
    ctx.lineTo(cx + radius + 18, cy);
    ctx.lineTo(cx + radius - 2, cy + 10);
    ctx.closePath();
    ctx.fillStyle = '#ef4444';
    ctx.fill();
}

function spinWheel() {
    const options = getWheelOptions();
    if (options.length < 2) {
        alert('至少填 2 个选项');
        return;
    }

    const canvas = document.getElementById('wheelCanvas');
    const duration = 4000;
    const totalRotation = 2 * Math.PI * 8 + Math.random() * 2 * Math.PI;
    const startTime = performance.now();

    function animate(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 4);
        const current = totalRotation * ease;
        drawWheel(current);

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            const sliceAngle = (2 * Math.PI) / options.length;
            const normalized = (2 * Math.PI - (current % (2 * Math.PI))) % (2 * Math.PI);
            const winner = Math.floor(normalized / sliceAngle) % options.length;
            setTimeout(() => {
                alert(`🎯 命运选中：${options[winner]}！`);
            }, 200);
        }
    }
    requestAnimationFrame(animate);
}

function addWheelOption() {
    const container = document.getElementById('wheelOptions');
    const inputs = container.querySelectorAll('.wheel-input');
    if (inputs.length >= 8) {
        alert('最多 8 个选项');
        return;
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'wheel-input';
    input.placeholder = `选项${inputs.length + 1}`;
    container.appendChild(input);
    drawWheel();
}

async function askAIForDecision() {
    const options = getWheelOptions();
    if (options.length < 2) {
        alert('至少填 2 个选项');
        return;
    }
    const resultEl = document.getElementById('wheelAIResult');
    resultEl.innerHTML = '<span class="ai-loading">🤖 AI 正在思考...</span>';

    const messages = [
        { role: 'system', content: '你是一个幽默的决策顾问，帮用户分析选项的利弊。语气轻松，像朋友聊天。' },
        { role: 'user', content: `我在纠结这几个选项：${options.join('、')}。请帮我简单分析每个选项的利弊，然后给一个推荐（带理由）。控制在80字以内。` }
    ];

    try {
        const answer = await callAI(messages);
        resultEl.innerHTML = `<div class="ai-bubble ai-bot" style="max-width:100%;margin-top:8px;">${escapeHtml(answer).replace(/\n/g, '<br>')}</div>`;
    } catch (e) {
        resultEl.textContent = 'AI 请求失败';
    }
}

// ==================== 数字滚动动画 ====================
function animateMoney(element, endValue, duration = 600) {
    const startText = element.textContent.replace(/[¥,]/g, '');
    const startValue = parseFloat(startText) || 0;
    if (startValue === endValue) return;
    element.classList.add('updating');
    const range = endValue - startValue;
    const startTime = performance.now();

    function step(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        const current = startValue + range * ease;
        element.textContent = formatMoney(current);
        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            element.classList.remove('updating');
        }
    }
    requestAnimationFrame(step);
}

// ==================== 初始化 ====================
async function init() {
    db = await openDB();
    updateTodayDate();
    loadBackground();
    loadTheme();

    // 加载已保存的 API Key
    const savedKey = getGeminiKey();
    if (savedKey) {
        const input = document.getElementById('geminiKeyInput');
        if (input) input.value = savedKey;
    }

    // 设置默认日期为今天
    document.getElementById('financeDate').value = todayStr();
    document.getElementById('diaryDate').value = todayStr();
    document.getElementById('sleepDate').value = todayStr();

    // 默认显示课表
    switchModule('schedule');

    // 转盘输入框监听
    document.querySelectorAll('.wheel-input').forEach(input => {
        input.addEventListener('input', () => drawWheel());
    });

    // 注册 Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    // 初始化云端同步
    await initSync();
}

init();
