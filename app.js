/* =========================================================
   [01] Firebase 初期化（Config / Firestore）
   ========================================================= */
const firebaseConfig = {
    apiKey: "AIzaSyBrO_NQFJ0ydJ7Q2PplQ-HvaYRcrBwT-cc",
    authDomain: "calendar-d5e4a.firebaseapp.com",
    projectId: "calendar-d5e4a",
    storageBucket: "calendar-d5e4a.firebasestorage.app",
    messagingSenderId: "871544558459",
    appId: "1:871544558459:web:c5b2f70afbd32100da23de",
    measurementId: "G-W3LJFK6FB3"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
let eventModalMode = "new";
/* ===== [01] end ===== */


/* =========================================================
   [02] ユーティリティ関数（DOM / 日付 / タグ / URL / escape）
   ========================================================= */
function qs(id) { return document.getElementById(id); }

function toDatetimeLocalValue(date) {
    const pad = (n) => String(n).padStart(2, "0");
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const mi = pad(date.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function parseTags(input) {
    return (input || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
}

function isValidXUrl(url) {
    if (!url) return true;
    try {
        const u = new URL(url);
        return (u.hostname === "x.com" || u.hostname === "twitter.com") && u.protocol === "https:";
    } catch {
        return false;
    }
}

function toLocalIsoNoZ(d) {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 19);
}

function localIsoNoZToDate(s) {
    const [d, t] = s.split("T");
    const [y, m, day] = d.split("-").map(Number);
    const [hh, mm, ss] = t.split(":").map(Number);
    return new Date(y, m - 1, day, hh, mm, ss || 0, 0);
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}
/* ===== [02] end ===== */


/* =========================================================
   [03] 設定（localStorage：名前/週開始/初期ビュー/タグプリセット）
   ========================================================= */
const LS_KEY = "calendar_settings_v1";
const defaultSettings = {
    name: "名無し",
    weekStart: 0,
    initialView: "dayGridMonth",
    tagPresets: "ライブ,告知,作業,集会"
};

function loadSettings() {
    try {
        return { ...defaultSettings, ...(JSON.parse(localStorage.getItem(LS_KEY)) || {}) };
    } catch {
        return { ...defaultSettings };
    }
}
function saveSettings(s) {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
}
let settings = loadSettings();
/* ===== [03] end ===== */


/* =========================================================
   [04] Auth（匿名ログイン）※ログイン後に購読開始
   ========================================================= */
let currentUser = null;

firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) {
        await firebase.auth().signInAnonymously();
        return;
    }
    currentUser = user;
    console.log("Signed in:", user.uid);

    // ★ ユーザー名が未決定なら選択画面へ（購読開始しない）
    if (!settings.name || settings.name === "名無し") {
        await loadAndShowUserPicker();
        return;
    }

    // 決まっているなら開始
    startEventsSubscription();
});
/* ===== [04] end ===== */


/* =========================================================
   [05] DOM参照（モーダル・フォーム・一覧・ボタン類）
   ========================================================= */
const eventModal = qs("eventModal");
const f_title = qs("f_title");
const f_start = qs("f_start");
const f_end = qs("f_end");
const f_xurl = qs("f_xurl");
const f_tags = qs("f_tags");
const f_memo = qs("f_memo");
const f_creator = qs("f_creator");
const btnClose = qs("btnClose");
const btnSave = qs("btnSave");
const btnDelete = qs("btnDelete");
const tagPalette = qs("tagPalette");

const f_repeatType = qs("f_repeatType");
const repeatOptionsRow = qs("repeatOptionsRow");
const f_weekday = qs("f_weekday");

const dayModal = qs("dayModal");
const dayTitle = qs("dayTitle");
const dayList = qs("dayList");
const dayClose = qs("dayClose");
const dayAdd = qs("dayAdd");

// ===== ユーザー名選択モーダル DOM =====
const userPickerModal = qs("userPickerModal");
const u_list = qs("u_list");
const u_new = qs("u_new");
const u_add = qs("u_add");
const u_search = qs("u_search");
const u_reload = qs("u_reload");

let activeDayDate = null;

f_start.setAttribute("step", "300");
f_end.setAttribute("step", "300");

function getSelectedNth() {
    return [...document.querySelectorAll(".nth:checked")].map(el => el.value);
}
/* ===== [05] end ===== */


/* =========================================================
   [06] 日付表示・UI補助（繰り返しUI / 時刻表示 / 同日判定）
   ========================================================= */
function updateRepeatUI() {
    if (!f_repeatType) return;
    const v = f_repeatType.value;
    repeatOptionsRow.style.display = (v === "nthWeekdayMonthly") ? "flex" : "none";
}
f_repeatType?.addEventListener("change", updateRepeatUI);

function isSameYMD(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

function fmtTime(d) {
    if (!d) return "終日";
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}
function fmtTimeRange(start, end) {
    if (!start) return "終日";
    const s = fmtTime(start);
    if (!end) return s;
    return `${s}～${fmtTime(end)}`;
}
function fmtYMDJa(d) {
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
/* ===== [06] end ===== */


/* =========================================================
   [07] 日別モーダル（その日の予定一覧 / 編集 / Xを開く / 削除）
   ========================================================= */
function openDayModal(date) {
    activeDayDate = date;
    dayTitle.textContent = `${fmtYMDJa(date)} の予定（時刻順）`;

    const events = calendar.getEvents()
        .filter(ev => ev.start && isSameYMD(ev.start, date))
        .sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0));

    dayList.innerHTML = "";

    if (events.length === 0) {
        dayList.innerHTML = `<div class="muted">この日の予定はありません。</div>`;
    } else {
        for (const ev of events) {
            const tags = (ev.extendedProps.tags || []).join(" / ");
            const who = ev.extendedProps.createdByName || "";
            const xurl = ev.extendedProps.x_url || "";
            const isOccurrence = !!ev.extendedProps.parentId && !!ev.extendedProps.occurrenceIso;

            const item = document.createElement("div");
            item.className = "day-item";

            item.innerHTML = `
        <div class="day-item-top">
          <div class="day-time">${fmtTimeRange(ev.start, ev.end)}</div>
          <div class="day-title">${escapeHtml(ev.title)}</div>
          <div class="muted">${who ? "by " + escapeHtml(who) : ""}</div>
        </div>
        ${tags ? `<div class="day-tags">タグ: ${escapeHtml(tags)}</div>` : ""}

${(ev.extendedProps.memo || "").trim()
                    ? `<div class="day-memo">${escapeHtml(ev.extendedProps.memo)}</div>`
                    : ""}

<div class="day-actions">
          ${xurl ? `<button class="btn" data-act="openx">Xを開く</button>` : ""}
          <button class="btn primary" data-act="edit">編集</button>
          ${isOccurrence ? `<button class="btn danger" data-act="del-one">この回だけ削除</button>` : ""}
          ${isOccurrence ? `<button class="btn danger" data-act="del-series">シリーズ全体削除</button>` : ""}
        </div>
      `;

            item.addEventListener("click", async (e) => {
                const act = e.target?.dataset?.act;
                if (!act) return;
                e.stopPropagation();

                if (act === "openx" && xurl) {
                    window.open(xurl, "_blank");
                    return;
                }

                if (act === "edit") {
                    closeDayModal();
                    openEventModal({
                        mode: "edit",
                        docId: ev.extendedProps.parentId || ev.id,
                        data: {
                            title: ev.title,
                            start: ev.start ? toLocalIsoNoZ(ev.start) : "",
                            end: ev.end ? toLocalIsoNoZ(ev.end) : "",
                            memo: ev.extendedProps.memo || "",
                            x_url: xurl,
                            tags: ev.extendedProps.tags || [],
                            createdByName: who,
                            rrule: ev.extendedProps.rrule || "",
                            parentId: ev.extendedProps.parentId || "",
                            occurrenceIso: ev.extendedProps.occurrenceIso || ""
                        }
                    });
                    return;
                }

                if (act === "del-one") {
                    const parentId = ev.extendedProps.parentId;
                    const occIso = ev.extendedProps.occurrenceIso;
                    if (!parentId || !occIso) return;
                    if (!confirm("この回だけ削除する？（シリーズは残ります）")) return;

                    await db.collection("events").doc(parentId).update({
                        exdates: firebase.firestore.FieldValue.arrayUnion(occIso),
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    openDayModal(new Date(activeDayDate));
                    return;
                }

                if (act === "del-series") {
                    const parentId = ev.extendedProps.parentId;
                    if (!parentId) return;
                    if (!confirm("シリーズ全体を削除する？（全ての回が消えます）")) return;

                    await db.collection("events").doc(parentId).delete();
                    openDayModal(new Date(activeDayDate));
                    return;
                }
            });

            dayList.appendChild(item);
        }
    }

    dayModal.classList.remove("hidden");
    document.body.classList.add("modal-open");
}

function closeDayModal() {
    dayModal.classList.add("hidden");
    document.body.classList.remove("modal-open");
}

dayClose?.addEventListener("click", closeDayModal);
dayModal?.addEventListener("click", (e) => { if (e.target === dayModal) closeDayModal(); });

dayAdd?.addEventListener("click", () => {
    const d = activeDayDate ? new Date(activeDayDate) : new Date();
    openEventModal({
        mode: "new",
        docId: null,
        data: { createdByName: settings.name || "名無し", tags: [] },
        startDate: d
    });
});
/* ===== [07] end ===== */


/* =========================================================
   [08] タグパレット（タグ一覧作成 / クリックで入力に反映）
   ========================================================= */
let globalTagSet = new Set();

function rebuildTagPalette() {
    if (!tagPalette) return;
    tagPalette.innerHTML = "";

    const presetTags = parseTags(settings.tagPresets || "");
    const all = new Set([...presetTags, ...globalTagSet]);

    [...all].sort((a, b) => a.localeCompare(b, 'ja')).forEach(tag => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tag-chip";
        btn.textContent = tag;

        btn.addEventListener("click", () => {
            const current = new Set(parseTags(f_tags.value));
            if (current.has(tag)) current.delete(tag);
            else current.add(tag);
            f_tags.value = [...current].join(",");
            btn.classList.toggle("active");
        });

        tagPalette.appendChild(btn);
    });
}
/* ===== [08] end ===== */


/* =========================================================
   [09] 予定モーダル（開く/閉じる/時刻変更時の補正）
   ========================================================= */
let activeEventId = null;
let activeParentId = null;
let activeOccurrenceIso = null;
let lastDurationMs = 60 * 60 * 1000;

function openEventModal({ mode, docId, data, startDate }) {
    eventModalMode = mode;
    activeEventId = docId || null;
    activeParentId = data?.parentId || null;
    activeOccurrenceIso = data?.occurrenceIso || null;

    qs("modalTitle").textContent = (mode === "new") ? "予定を追加" : "予定を編集";

    f_title.value = data?.title || "";
    f_memo.value = data?.memo || "";
    f_xurl.value = data?.x_url || "";
    f_tags.value = (data?.tags || []).join(",");

    const start = data?.start ? new Date(data.start) : (startDate || new Date());
    f_start.value = toDatetimeLocalValue(start);

    if (data?.end) f_end.value = toDatetimeLocalValue(new Date(data.end));
    else f_end.value = "";

    const s = new Date(f_start.value);
    const e = f_end.value ? new Date(f_end.value) : null;
    lastDurationMs = e ? (e.getTime() - s.getTime()) : (60 * 60 * 1000);

    f_creator.textContent = data?.createdByName || "(不明)";
    btnDelete.style.display = (mode === "new") ? "none" : "inline-block";

    eventModal.classList.remove("hidden");
    rebuildTagPalette();
    document.body.classList.add("modal-open");
    updateRepeatUI();
}

function closeEventModal() {
    eventModal.classList.add("hidden");
    activeEventId = null;
    document.body.classList.remove("modal-open");
}

btnClose.addEventListener("click", closeEventModal);

eventModal.addEventListener("click", (e) => {
    if (e.target !== eventModal) return;
    if (eventModalMode === "new") return; // 新規追加時は閉じない
    closeEventModal();
});

f_start.addEventListener("change", () => {
    const s = new Date(f_start.value);
    if (isNaN(s)) return;
    const e = new Date(s.getTime() + lastDurationMs);
    f_end.value = toDatetimeLocalValue(e);
});

f_end.addEventListener("change", () => {
    const s = new Date(f_start.value);
    const e = new Date(f_end.value);
    if (isNaN(s) || isNaN(e)) return;
    lastDurationMs = e.getTime() - s.getTime();
});
/* ===== [09] end ===== */


/* =========================================================
   [10] 繰り返し（RRULE）補助：曜日/第N/UTC固定変換など
   ========================================================= */
function getNthOfDateInMonth(date) {
    const y = date.getFullYear();
    const m = date.getMonth();
    const weekday = date.getDay();

    const first = new Date(y, m, 1);
    const diff = (weekday - first.getDay() + 7) % 7;
    const firstOccur = 1 + diff;

    const nth = Math.floor((date.getDate() - firstOccur) / 7) + 1;

    const next = new Date(y, m, date.getDate() + 7);
    const isLast = next.getMonth() !== m;

    return isLast ? -1 : nth;
}

function localPartsAsUTCDate(d) {
    return new Date(Date.UTC(
        d.getFullYear(), d.getMonth(), d.getDate(),
        d.getHours(), d.getMinutes(), d.getSeconds() || 0, 0
    ));
}

function utcPartsToLocalDate(dt) {
    return new Date(
        dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(),
        dt.getUTCHours(), dt.getUTCMinutes(), dt.getUTCSeconds(), 0
    );
}

function weekdayToRRule(dayIndex) {
    return ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][dayIndex];
}

function nthWeekdayDateOfMonth(baseDate, nth, weekdayIndex) {
    const y = baseDate.getFullYear();
    const m = baseDate.getMonth();

    if (nth > 0) {
        const first = new Date(y, m, 1);
        const diff = (weekdayIndex - first.getDay() + 7) % 7;
        const day = 1 + diff + (nth - 1) * 7;
        return new Date(y, m, day, baseDate.getHours(), baseDate.getMinutes(), 0, 0);
    } else {
        const last = new Date(y, m + 1, 0);
        const diff = (last.getDay() - weekdayIndex + 7) % 7;
        const day = last.getDate() - diff;
        return new Date(y, m, day, baseDate.getHours(), baseDate.getMinutes(), 0, 0);
    }
}
/* ===== [10] end ===== */


/* =========================================================
   [11] 保存処理（新規/更新/例外：overrides / rrule生成）
   ========================================================= */
btnSave.addEventListener("click", async () => {

    if (!settings.name || settings.name === "名無し") {
        alert("ユーザー名を選択してください");
        await loadAndShowUserPicker();
        return;
    }
    const title = f_title.value.trim();
    if (!title) return alert("タイトル必須");

    const startLocal = new Date(f_start.value);
    const endLocal = f_end.value ? new Date(f_end.value) : null;

    const payload = {
        title,
        start: toLocalIsoNoZ(startLocal),
        end: endLocal ? toLocalIsoNoZ(endLocal) : "",
        memo: f_memo.value || "",
        x_url: f_xurl.value || "",
        tags: parseTags(f_tags.value),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    let rrule = "";
    if (f_repeatType.value === "weekly") {
        rrule = "FREQ=WEEKLY;INTERVAL=1";
    } else if (f_repeatType.value === "bimonthly") {
        rrule = "FREQ=MONTHLY;INTERVAL=2";
    } else if (f_repeatType.value === "nthWeekdayMonthly") {
        const nthList = getSelectedNth();
        if (nthList.length === 0) {
            alert("「第」を1つ以上選んでね（例：第1・第3）");
            return;
        }
        const wd = weekdayToRRule(startLocal.getDay());
        rrule = `FREQ=MONTHLY;BYDAY=${wd};BYSETPOS=${nthList.join(",")}`;
    }
    payload.rrule = rrule;

    // override（単発修正）
    if (activeParentId && activeOccurrenceIso) {
        const patch = {};
        patch[`overrides.${activeOccurrenceIso}`] = {
            title: payload.title,
            memo: payload.memo,
            x_url: payload.x_url,
            tags: payload.tags
        };
        await db.collection("events").doc(activeParentId).update({
            ...patch,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        closeEventModal();
        if (!dayModal.classList.contains("hidden") && activeDayDate) openDayModal(new Date(activeDayDate));
        return;
    }

    // 通常の新規/更新
    if (!activeEventId) {
        await db.collection("events").add({
            ...payload,
            createdByName: settings.name,
            createdByUid: currentUser?.uid || "",
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    } else {
        await db.collection("events").doc(activeEventId).update(payload);
    }

    closeEventModal();
    if (!dayModal.classList.contains("hidden") && activeDayDate) openDayModal(new Date(activeDayDate));
});
/* ===== [11] end ===== */


/* =========================================================
   [12] 削除処理（単発doc削除）
   ========================================================= */
btnDelete.addEventListener("click", async () => {
    if (!activeEventId) return;
    if (!confirm("この予定を削除する？")) return;

    try {
        await db.collection("events").doc(activeEventId).delete();
        closeEventModal();
    } catch (err) {
        console.error(err);
        alert("削除に失敗しました（コンソールを見てね）");
    }
});
/* ===== [12] end ===== */


/* =========================================================
   [13] 設定モーダル（開く/閉じる/保存→reload）
   ========================================================= */
const settingsModal = qs("settingsModal");
const openSettings = qs("openSettings");
const s_name = qs("s_name");
const s_weekStart = qs("s_weekStart");
const s_initialView = qs("s_initialView");
const s_tagPresets = qs("s_tagPresets");
const btnSettingsClose = qs("btnSettingsClose");
const btnSettingsSave = qs("btnSettingsSave");

function openSettingsModal() {
    s_name.value = settings.name || "";
    s_weekStart.value = String(settings.weekStart ?? 0);
    s_initialView.value = settings.initialView || "dayGridMonth";
    s_tagPresets.value = settings.tagPresets || "";
    settingsModal.classList.remove("hidden");
    document.body.classList.add("modal-open");
}

function closeSettingsModal() {
    settingsModal.classList.add("hidden");
    document.body.classList.remove("modal-open");
}

openSettings.addEventListener("click", openSettingsModal);
btnSettingsClose.addEventListener("click", closeSettingsModal);
settingsModal.addEventListener("click", (e) => { if (e.target === settingsModal) closeSettingsModal(); });

btnSettingsSave.addEventListener("click", () => {
    settings = {
        ...settings,
        name: (s_name.value.trim() || "名無し"),
        weekStart: Number(s_weekStart.value),
        initialView: s_initialView.value,
        tagPresets: s_tagPresets.value
    };
    saveSettings(settings);
    closeSettingsModal();
    location.reload();
});
/* ===== [13] end ===== */


/* =========================================================
   [13.5] ユーザー名選択（Firestore users）
   ========================================================= */
function normalizeName(name) {
    return String(name || "").trim().replace(/\s+/g, " ");
}
function nameDocId(name) {
    return normalizeName(name).toLowerCase();
}

async function fetchUserNames() {
    const snap = await db.collection("users").orderBy("createdAt", "desc").limit(200).get();
    const arr = [];
    snap.forEach(doc => {
        const d = doc.data();
        if (d?.displayName) arr.push(d.displayName);
    });
    return arr;
}

function openUserPicker() {
    userPickerModal.classList.remove("hidden");
    document.body.classList.add("modal-open");
}
function closeUserPicker() {
    userPickerModal.classList.add("hidden");
    document.body.classList.remove("modal-open");
}

function renderUserList(names, keyword = "") {
    const kw = normalizeName(keyword).toLowerCase();
    u_list.innerHTML = "";

    const filtered = names
        .map(n => normalizeName(n))
        .filter(Boolean)
        .filter(n => !kw || n.toLowerCase().includes(kw))
        .sort((a, b) => a.localeCompare(b, "ja"));

    if (filtered.length === 0) {
        u_list.innerHTML = `<div class="muted">該当するユーザー名がありません。</div>`;
        return;
    }

    filtered.forEach(n => {
        const row = document.createElement("div");
        row.className = "user-item";
        row.innerHTML = `
      <div class="name">${escapeHtml(n)}</div>
      <button class="btn primary">この名前で入る</button>
    `;
        row.querySelector("button").addEventListener("click", () => {
            settings.name = n;
            saveSettings(settings);
            closeUserPicker();
            startEventsSubscription();
        });
        u_list.appendChild(row);
    });
}

async function loadAndShowUserPicker() {
    openUserPicker();
    u_list.innerHTML = `<div class="muted">読み込み中...</div>`;

    try {
        const names = await fetchUserNames();
        renderUserList(names, u_search?.value || "");
    } catch (e) {
        console.error(e);
        u_list.innerHTML = `<div class="muted">ユーザー一覧の取得に失敗しました。</div>`;
    }
}

async function registerUserName() {
    const name = normalizeName(u_new.value);
    if (!name) return alert("ユーザー名を入力してね");
    if (name.length > 24) return alert("ユーザー名は24文字以内にしてね");

    const id = nameDocId(name);
    const ref = db.collection("users").doc(id);

    try {
        await db.runTransaction(async (tx) => {
            const doc = await tx.get(ref);
            if (doc.exists) throw new Error("DUP");
            tx.set(ref, {
                displayName: name,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        settings.name = name;
        saveSettings(settings);
        closeUserPicker();
        startEventsSubscription();
    } catch (e) {
        if (String(e?.message).includes("DUP")) {
            alert("その名前は既に使われています。別の名前にしてね");
            return;
        }
        console.error(e);
        alert("登録に失敗しました（コンソールを見てね）");
    }
}

u_add?.addEventListener("click", registerUserName);
u_reload?.addEventListener("click", loadAndShowUserPicker);
u_search?.addEventListener("input", loadAndShowUserPicker);

// 外側クリックで閉じない（必須選択にするため）
userPickerModal?.addEventListener("click", (e) => {
    if (e.target === userPickerModal) {
        // closeUserPicker(); // ←閉じたいならコメント外す
    }
});
/* ===== [13.5] end ===== */


/* =========================================================
   [14] FullCalendar 初期化（表示/クリック/イベント描画）
   ========================================================= */
const calendarEl = document.getElementById("calendar");

const calendar = new FullCalendar.Calendar(calendarEl, {
    timeZone: "local",
    dayMaxEventRows: false,
    locale: 'ja',
    initialView: settings.initialView,
    firstDay: settings.weekStart,
    selectable: true,
    nowIndicator: true,
    showNonCurrentDates: false,
    fixedWeekCount: false,
    height: "auto",
    contentHeight: "auto",
    expandRows: true,

    dateClick(info) { openDayModal(info.date); },
    eventClick(info) { openDayModal(info.event.start); },

    eventContent(arg) {
        const tags = arg.event.extendedProps.tags || [];
        const who = arg.event.extendedProps.createdByName || "";

        const wrap = document.createElement("div");
        wrap.style.fontSize = "12px";
        wrap.style.lineHeight = "1.25";

        const t = document.createElement("div");
        t.innerHTML = `<b>${escapeHtml(arg.event.title)}</b>`;
        wrap.appendChild(t);

        if (tags.length) {
            const tagRow = document.createElement("div");
            tags.forEach(tgName => {
                const span = document.createElement("span");
                span.className = "event-tag";
                span.textContent = tgName;
                tagRow.appendChild(span);
            });
            wrap.appendChild(tagRow);
        }

        if (who) {
            const w = document.createElement("div");
            w.className = "muted";
            w.textContent = `by ${who}`;
            wrap.appendChild(w);
        }

        return { domNodes: [wrap] };
    }
});

calendar.render();
/* ===== [14] end ===== */


/* =========================================================
   [15] RRULE展開（Firestoreのrrule→FullCalendar eventsへ展開）
   ========================================================= */
function expandRRuleToEvents(docId, d, rangeStart, rangeEnd) {
    const RRuleClass = window.RRule || (window.rrule && window.rrule.RRule);
    if (!RRuleClass) return [];

    const baseStartLocal = new Date(d.start);
    const baseEndLocal = d.end ? new Date(d.end) : null;
    const durationMs = baseEndLocal ? (baseEndLocal.getTime() - baseStartLocal.getTime()) : 0;

    const opts = RRuleClass.parseString(d.rrule);
    opts.dtstart = localPartsAsUTCDate(baseStartLocal);

    const rangeStartUTC = localPartsAsUTCDate(rangeStart);
    const rangeEndUTC = localPartsAsUTCDate(rangeEnd);

    const rule = new RRuleClass(opts);
    const datesUTC = rule.between(rangeStartUTC, rangeEndUTC, true);

    const exdates = new Set(Array.isArray(d.exdates) ? d.exdates : []);
    const overrides = (d.overrides && typeof d.overrides === "object") ? d.overrides : {};

    return datesUTC.map((dtUTC) => {
        const sLocal = utcPartsToLocalDate(dtUTC);
        const occKey = toLocalIsoNoZ(sLocal);
        if (exdates.has(occKey)) return null;

        const ov = overrides[occKey] || {};
        let eLocal = null;
        if (durationMs) eLocal = new Date(sLocal.getTime() + durationMs);

        return {
            id: `${docId}_${occKey}`,
            title: ov.title ?? d.title ?? "(no title)",
            start: ov.start ? localIsoNoZToDate(ov.start) : sLocal,
            end: ov.end ? localIsoNoZToDate(ov.end) : eLocal,
            extendedProps: {
                memo: ov.memo ?? (d.memo || ""),
                x_url: ov.x_url ?? (d.x_url || ""),
                tags: ov.tags ?? (Array.isArray(d.tags) ? d.tags : []),
                createdByName: d.createdByName || "",
                parentId: docId,
                occurrenceIso: occKey,
                rrule: d.rrule || ""
            }
        };
    }).filter(Boolean);
}
/* ===== [15] end ===== */


/* =========================================================
   [16] Firestore購読（ログイン後 startEventsSubscription で開始）
   ========================================================= */
let unsubscribeEvents = null;

function startEventsSubscription() {
    if (unsubscribeEvents) unsubscribeEvents();

    unsubscribeEvents = db.collection("events").orderBy("createdAt", "desc").onSnapshot((snapshot) => {
        calendar.removeAllEvents();
        globalTagSet = new Set();

        const view = calendar.view;
        const rangeStart = new Date(view.activeStart);
        rangeStart.setMonth(rangeStart.getMonth() - 12);
        const rangeEnd = new Date(view.activeEnd);
        rangeEnd.setMonth(rangeEnd.getMonth() + 12);

        snapshot.forEach((doc) => {
            const d = doc.data();

            // タグ集計
            const tags = Array.isArray(d.tags) ? d.tags : [];
            for (const t of tags) {
                const s = String(t).trim();
                if (s) globalTagSet.add(s);
            }

            try {
                if (d.rrule) {
                    const expanded = expandRRuleToEvents(doc.id, d, rangeStart, rangeEnd);
                    for (const ev of expanded) calendar.addEvent(ev);
                } else {
                    calendar.addEvent({
                        id: doc.id,
                        title: d.title || "(no title)",
                        start: d.start || null,
                        end: d.end || null,
                        extendedProps: {
                            memo: d.memo || "",
                            x_url: d.x_url || "",
                            tags,
                            createdByName: d.createdByName || "",
                            rrule: d.rrule || ""
                        }
                    });
                }
            } catch (e) {
                console.error("イベント展開でエラー:", doc.id, d, e);
            }
        });

        rebuildTagPalette();
    });
}
/* ===== [16] end ===== */

最初にユーザー名選択画面その中に自分の名前がない場合ユーザー名登録できるようにしたい
パスワード等はいらない