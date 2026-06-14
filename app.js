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

// タグ名 → 色（決定的ハッシュ。同じタグ名なら常に同じ色になる）
function tagHue(tagName) {
    const s = String(tagName || "");
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    }
    return hash % 360;
}

// タグ名 → hsl(...) 文字列（CSS変数 --tag-color に使う）
function tagColor(tagName, sat = 70, light = 60) {
    return `hsl(${tagHue(tagName)}, ${sat}%, ${light}%)`;
}

// タグ配列から「代表タグ」の色を取得（先頭タグ基準。タグなしならnull）
function primaryTagColor(tags) {
    const t = Array.isArray(tags) ? tags : [];
    if (t.length === 0) return null;
    return tagColor(t[0]);
}

// 初期読み込みオーバーレイを隠す（ユーザー選択待ち or 初回データ受信時に呼ぶ）
function hideLoadingOverlay() {
    const el = document.getElementById("loadingOverlay");
    if (el) el.classList.add("hidden");
}

// 読み込み中オーバーレイにエラーメッセージを表示する（接続失敗時）
function showLoadingError(message) {
    const el = document.getElementById("loadingOverlay");
    if (!el) return;
    el.classList.remove("hidden");
    el.innerHTML = `
        <div class="loading-text">${escapeHtml(message)}</div>
        <button id="loadingRetry" class="btn primary">再読み込み</button>
    `;
    document.getElementById("loadingRetry")?.addEventListener("click", () => location.reload());
}
/* ===== [02] end ===== */

// ★タブを閉じるまで保持するフラグ
window.alreadyAskedThisSession = function () {
    return sessionStorage.getItem("asked_user_picker") === "1";
};

window.markAskedThisSession = function () {
    sessionStorage.setItem("asked_user_picker", "1");
};

window.clearAskedThisSession = function () {
    sessionStorage.removeItem("asked_user_picker");
};

function isValidVrcGroupUrl(url) {
    if (!url) return true;
    try {
        const u = new URL(url);
        if (u.protocol !== "https:") return false;

        // vrc.group/xxxx.xxxx 形式
        if (u.hostname === "vrc.group") return true;

        // vrchat.com/home/group/... 形式（公式サイト）
        if (u.hostname === "vrchat.com") {
            // /home/group/grp_... や /home/group/grp_.../...
            return u.pathname.startsWith("/home/group/");
        }
        return false;
    } catch {
        return false;
    }
}


/* =========================================================
   [03] 設定（localStorage：名前/週開始/初期ビュー/タグプリセット）
   ========================================================= */
const LS_KEY = "calendar_settings_v1";
const defaultSettings = {
    name: "名無し",
    weekStart: 0,
    initialView: "dayGridMonth",
    tagPresets: "ライブ,告知,作業,集会",
    excludedTags: [],
    upcomingCollapsed: false,
    notifyEnabled: false,
    notifyMinutes: 30
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
function alreadyAskedThisSession() {
    return sessionStorage.getItem("asked_user_picker") === "1";
}
function markAskedThisSession() {
    sessionStorage.setItem("asked_user_picker", "1");
}

let currentUser = null;

window.addEventListener("DOMContentLoaded", () => {
    // 通信が遅い/失敗した場合に、ローディング画面が固まったままにならないようにする
    const authTimeout = setTimeout(() => {
        showLoadingError("読み込みに時間がかかっています。通信環境を確認してください。");
    }, 15000);

    firebase.auth().onAuthStateChanged(async (user) => {
        if (!user) {
            try {
                await firebase.auth().signInAnonymously();
            } catch (e) {
                console.error("匿名ログインに失敗:", e);
                clearTimeout(authTimeout);
                showLoadingError("ログインに失敗しました。通信環境を確認してください。");
            }
            return;
        }
        clearTimeout(authTimeout);
        currentUser = user;

        // ★既に選択済みなら購読開始（選択画面は出さない）
        if (alreadyAskedThisSession()) {
            if (settings.name && settings.name !== "名無し") {
                startEventsSubscription();
            } else {
                sessionStorage.removeItem("asked_user_picker");
                await loadAndShowUserPicker();
            }
            return;
        }

        // ★初回だけピッカー（選択後に購読開始）
        await loadAndShowUserPicker();
    });
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
const repeatNote = qs("repeatNote");

const dayModal = qs("dayModal");
const dayTitle = qs("dayTitle");
const dayList = qs("dayList");
const dayClose = qs("dayClose");
const dayAdd = qs("dayAdd");

const f_vrcgroup = qs("f_vrcgroup");

// ===== 近日の予定パネル / タグフィルター DOM =====
const upcomingPanel = qs("upcomingPanel");
const upcomingList = qs("upcomingList");
const upcomingToggle = qs("upcomingToggle");
const tagFilter = qs("tagFilter");

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
            const tagList = ev.extendedProps.tags || [];
            const tagsHtml = tagList.length
                ? `<div class="day-tags">${tagList.map(t => `<span class="event-tag" style="--tag-color:${tagColor(t)}">${escapeHtml(t)}</span>`).join("")}</div>`
                : "";
            const who = ev.extendedProps.createdByName || "";
            const xurl = ev.extendedProps.x_url || "";
            const vrcurl = (ev.extendedProps.vrc_group_url || "").trim();
            const isOccurrence = !!ev.extendedProps.parentId && !!ev.extendedProps.occurrenceIso;

            const item = document.createElement("div");
            item.className = "day-item";
            const dayItemTags = ev.extendedProps.tags || [];
            const dayItemColor = primaryTagColor(dayItemTags);
            if (dayItemColor) item.style.setProperty("--tag-color", dayItemColor);

            item.innerHTML = `
        <div class="day-item-top">
          <div class="day-time">${fmtTimeRange(ev.start, ev.end)}</div>
          <div class="day-title">${escapeHtml(ev.title)}</div>
          <div class="muted">${who ? "by " + escapeHtml(who) : ""}</div>
        </div>
        ${tagsHtml}

${(ev.extendedProps.memo || "").trim()
                    ? `<div class="day-memo">${escapeHtml(ev.extendedProps.memo)}</div>`
                    : ""}

<div class="day-actions">
          ${xurl ? `<button class="btn" data-act="openx">Xを開く</button>` : ""}
          ${vrcurl ? `<button class="btn" data-act="openvrc">VRCグループを開く</button>` : ""}
          <button class="btn primary" data-act="edit">編集</button>
          <button class="btn" data-act="duplicate">複製</button>
          <button class="btn" data-act="ics">カレンダーに追加</button>
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

                if (act === "openvrc" && vrcurl) {
                    window.open(vrcurl, "_blank");
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
                            occurrenceIso: ev.extendedProps.occurrenceIso || "",
                            vrc_group_url: vrcurl,
                        }
                    });
                    return;
                }

                if (act === "ics") {
                    downloadIcsForEvent(ev);
                    return;
                }

                if (act === "duplicate") {
                    closeDayModal();
                    openEventModal({
                        mode: "new",
                        docId: null,
                        data: {
                            title: `${ev.title}のコピー`,
                            start: ev.start ? toLocalIsoNoZ(ev.start) : "",
                            end: ev.end ? toLocalIsoNoZ(ev.end) : "",
                            memo: ev.extendedProps.memo || "",
                            x_url: xurl,
                            vrc_group_url: vrcurl,
                            tags: ev.extendedProps.tags || [],
                            createdByName: settings.name || "名無し",
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
        btn.style.setProperty("--tag-color", tagColor(tag));
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

    applyRRuleToForm(data?.rrule || "");

    // この回だけの編集（override）では、繰り返し設定はここでは変更できない
    const isOccurrenceEdit = !!(activeParentId && activeOccurrenceIso);
    f_repeatType.disabled = isOccurrenceEdit;
    document.querySelectorAll(".nth").forEach(el => el.disabled = isOccurrenceEdit);
    repeatNote.style.display = isOccurrenceEdit ? "block" : "none";

    f_vrcgroup.value = data?.vrc_group_url || "";

    setTimeout(() => f_title.focus(), 0);
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

// 所要時間クイック設定ボタン
document.querySelectorAll("#durationQuick button[data-min]").forEach(btn => {
    btn.addEventListener("click", () => {
        const s = new Date(f_start.value);
        if (isNaN(s)) return;
        const ms = Number(btn.dataset.min) * 60000;
        f_end.value = toDatetimeLocalValue(new Date(s.getTime() + ms));
        lastDurationMs = ms;
    });
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

function applyRRuleToForm(rruleStr) {
    document.querySelectorAll(".nth").forEach(el => el.checked = false);

    if (!rruleStr) {
        f_repeatType.value = "none";
    } else if (/BYSETPOS=/.test(rruleStr)) {
        f_repeatType.value = "nthWeekdayMonthly";
        const m = rruleStr.match(/BYSETPOS=([^;]+)/);
        if (m) {
            for (const n of m[1].split(",")) {
                const cb = document.querySelector(`.nth[value="${n}"]`);
                if (cb) cb.checked = true;
            }
        }
    } else if (/FREQ=MONTHLY;INTERVAL=2/.test(rruleStr)) {
        f_repeatType.value = "bimonthly";
    } else if (/FREQ=WEEKLY/.test(rruleStr)) {
        f_repeatType.value = "weekly";
    } else {
        f_repeatType.value = "none";
    }

    updateRepeatUI();
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

    if (endLocal && endLocal <= startLocal) {
        return alert("終了時刻は開始時刻より後にしてください");
    }

    const payload = {
        title,
        start: toLocalIsoNoZ(startLocal),
        end: endLocal ? toLocalIsoNoZ(endLocal) : "",
        memo: f_memo.value || "",
        x_url: f_xurl.value || "",
        tags: parseTags(f_tags.value),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        vrc_group_url: f_vrcgroup.value.trim() || "",
    };

    if (!isValidVrcGroupUrl(f_vrcgroup.value.trim())) {
        return alert("VRCグループリンクは公式URLのみ対応です（vrc.group / vrchat.com/home/group/）");
    }

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
            vrc_group_url: payload.vrc_group_url,   // ★追加
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
const s_notifyEnabled = qs("s_notifyEnabled");
const s_notifyMinutes = qs("s_notifyMinutes");
const btnSettingsClose = qs("btnSettingsClose");
const btnSettingsSave = qs("btnSettingsSave");

function openSettingsModal() {
    s_name.value = settings.name || "";
    s_weekStart.value = String(settings.weekStart ?? 0);
    s_initialView.value = settings.initialView || "dayGridMonth";
    s_tagPresets.value = settings.tagPresets || "";
    if (s_notifyEnabled) s_notifyEnabled.checked = !!settings.notifyEnabled;
    if (s_notifyMinutes) s_notifyMinutes.value = String(settings.notifyMinutes ?? 30);
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

// Escapeキーでモーダルを閉じる
document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!eventModal.classList.contains("hidden")) {
        if (eventModalMode === "new") return;
        closeEventModal();
        return;
    }
    if (!dayModal.classList.contains("hidden")) { closeDayModal(); return; }
    if (!settingsModal.classList.contains("hidden")) { closeSettingsModal(); return; }
});

btnSettingsSave.addEventListener("click", () => {
    settings = {
        ...settings,
        name: (s_name.value.trim() || "名無し"),
        weekStart: Number(s_weekStart.value),
        initialView: s_initialView.value,
        tagPresets: s_tagPresets.value,
        notifyEnabled: !!(s_notifyEnabled && s_notifyEnabled.checked),
        notifyMinutes: Number(s_notifyMinutes?.value || 30)
    };
    saveSettings(settings);

    if (settings.notifyEnabled) requestNotifyPermissionIfNeeded();

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
            markAskedThisSession();   // ★追加
            closeUserPicker();
            startEventsSubscription();
        });
        u_list.appendChild(row);
    });
}

async function loadAndShowUserPicker() {
    hideLoadingOverlay();
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
        markAskedThisSession();     // ★追加
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

// Firestoreから取得した生データ（カレンダーの表示範囲が変わった時に再展開するため保持）
let latestEventDocs = [];

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
    // 週/日表示で予定が重なって表示されないよう、時間が重複する予定は横に並べる
    slotEventOverlap: false,

    dateClick(info) { openDayModal(info.date); },
    eventClick(info) { openDayModal(info.event.start); },

    // タグ色を .fc-daygrid-event 要素自身に反映（左ボーダー用）
    eventDidMount(info) {
        const tags = info.event.extendedProps.tags || [];
        const pColor = primaryTagColor(tags);
        if (pColor) info.el.style.setProperty("--tag-color", pColor);
    },

    // 表示範囲（月/週/日）が変わったら、繰り返しイベントを新しい範囲で再展開する
    datesSet() { renderEventsToCalendar(); },

    eventContent(arg) {
        const tags = arg.event.extendedProps.tags || [];
        const who = arg.event.extendedProps.createdByName || "";
        // 週/日表示はマスが狭いので、タイトルのみのコンパクト表示にする
        const compact = arg.view.type.startsWith("timeGrid");

        const wrap = document.createElement("div");
        wrap.style.fontSize = "12px";
        wrap.style.lineHeight = "1.25";
        wrap.style.overflow = "hidden";

        const pColor = primaryTagColor(tags);
        if (pColor) wrap.style.setProperty("--tag-color", pColor);

        const t = document.createElement("div");
        t.innerHTML = `<b>${escapeHtml(arg.event.title)}</b>`;
        if (compact) {
            t.style.whiteSpace = "nowrap";
            t.style.overflow = "hidden";
            t.style.textOverflow = "ellipsis";
        }
        wrap.appendChild(t);

        if (compact) {
            const timeText = arg.timeText;
            if (timeText) {
                const time = document.createElement("div");
                time.className = "muted";
                time.style.fontSize = "11px";
                time.textContent = timeText;
                wrap.appendChild(time);
            }
            return { domNodes: [wrap] };
        }

        if (tags.length) {
            const tagRow = document.createElement("div");
            tags.forEach(tgName => {
                const span = document.createElement("span");
                span.className = "event-tag";
                span.style.setProperty("--tag-color", tagColor(tgName));
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
                vrc_group_url: ov.vrc_group_url ?? (d.vrc_group_url || ""), // ★追加
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

// latestEventDocs を元にカレンダーへイベントを再描画する
// （Firestoreデータの変化時 / カレンダーの表示範囲変更時の両方から呼ばれる）
function renderEventsToCalendar() {
    calendar.removeAllEvents();
    globalTagSet = new Set();

    // 表示範囲のみを展開対象にする（広い範囲を毎回展開するとナビゲーション時のラグの原因になる）
    const view = calendar.view;
    const rangeStart = new Date(view.activeStart);
    const rangeEnd = new Date(view.activeEnd);

    for (const { id: docId, data: d } of latestEventDocs) {
        // タグ集計
        const tags = Array.isArray(d.tags) ? d.tags : [];
        for (const t of tags) {
            const s = String(t).trim();
            if (s) globalTagSet.add(s);
        }

        try {
            if (d.rrule) {
                const expanded = expandRRuleToEvents(docId, d, rangeStart, rangeEnd);
                for (const ev of expanded) calendar.addEvent(ev);
            } else {
                calendar.addEvent({
                    id: docId,
                    title: d.title || "(no title)",
                    start: d.start || null,
                    end: d.end || null,
                    extendedProps: {
                        memo: d.memo || "",
                        x_url: d.x_url || "",
                        vrc_group_url: d.vrc_group_url || "",
                        tags,
                        createdByName: d.createdByName || "",
                        rrule: d.rrule || ""
                    }
                });
            }
        } catch (e) {
            console.error("イベント展開でエラー:", docId, d, e);
        }
    }

    rebuildTagPalette();
    rebuildTagFilter();
    applyTagFilterToCalendar();
    renderUpcomingPanel();
}

function startEventsSubscription() {
    if (unsubscribeEvents) unsubscribeEvents();

    unsubscribeEvents = db.collection("events").orderBy("createdAt", "desc").onSnapshot((snapshot) => {
        latestEventDocs = [];
        snapshot.forEach((doc) => {
            latestEventDocs.push({ id: doc.id, data: doc.data() });
        });
        renderEventsToCalendar();
        hideLoadingOverlay();
    }, (err) => {
        console.error("予定の取得に失敗:", err);
        showLoadingError("予定の読み込みに失敗しました。通信環境を確認してください。");
    });

    // 通知が有効なら、定期チェックを開始
    if (settings.notifyEnabled) {
        requestNotifyPermissionIfNeeded();
        startNotifyChecker();
    }
}
/* ===== [16] end ===== */


/* =========================================================
   [17] タグフィルター（未選択タグのイベントを非表示にする）
   ========================================================= */

// タグ配列が、除外タグ集合と交差するか（タグなしイベントは常に表示）
function isHiddenByTagFilter(tags) {
    const excluded = new Set(settings.excludedTags || []);
    if (excluded.size === 0) return false;
    const t = Array.isArray(tags) ? tags : [];
    if (t.length === 0) return false; // タグなしは常に表示
    return t.every(tag => excluded.has(tag));
}

function rebuildTagFilter() {
    if (!tagFilter) return;
    tagFilter.innerHTML = "";

    const presetTags = parseTags(settings.tagPresets || "");
    const all = new Set([...presetTags, ...globalTagSet]);

    if (all.size === 0) {
        tagFilter.innerHTML = `<span class="muted">タグはまだありません</span>`;
        return;
    }

    const excluded = new Set(settings.excludedTags || []);

    [...all].sort((a, b) => a.localeCompare(b, 'ja')).forEach(tag => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "filter-chip tag-chip";
        btn.style.setProperty("--tag-color", tagColor(tag));
        btn.textContent = tag;
        if (!excluded.has(tag)) btn.classList.add("active");

        btn.addEventListener("click", () => {
            const ex = new Set(settings.excludedTags || []);
            if (ex.has(tag)) ex.delete(tag);
            else ex.add(tag);
            settings.excludedTags = [...ex];
            saveSettings(settings);

            btn.classList.toggle("active");
            applyTagFilterToCalendar();
            renderUpcomingPanel();
        });

        tagFilter.appendChild(btn);
    });
}

// 現在カレンダーに表示中のイベントへタグフィルターを適用する（表示/非表示）
function applyTagFilterToCalendar() {
    const excluded = new Set(settings.excludedTags || []);
    calendar.getEvents().forEach(ev => {
        const tags = ev.extendedProps.tags || [];
        const hidden = isHiddenByTagFilter(tags);
        if (ev.setProp) ev.setProp("display", hidden ? "none" : "auto");
        // 非表示イベントもクリック判定を消すため、要素を直接操作する必要はない
        // （display:none で十分。FullCalendarが描画をスキップする）
    });
}
/* ===== [17] end ===== */


/* =========================================================
   [18] 近日の予定パネル（次の予定を一覧表示）
   ========================================================= */
function fmtMonthDayJaShort(d) {
    const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
    return `${d.getMonth() + 1}/${d.getDate()}(${wd})`;
}

// latestEventDocs から「今から先」の予定を一定数集めて返す
function collectUpcomingEvents(limit = 8) {
    const now = new Date();
    const rangeStart = new Date(now);
    rangeStart.setHours(0, 0, 0, 0); // 今日を含む
    const rangeEnd = new Date(now);
    rangeEnd.setDate(rangeEnd.getDate() + 60); // 60日先まで探す

    const results = [];

    for (const { id: docId, data: d } of latestEventDocs) {
        try {
            if (d.rrule) {
                const expanded = expandRRuleToEvents(docId, d, rangeStart, rangeEnd);
                for (const ev of expanded) {
                    if (ev.start && ev.start.getTime() >= now.getTime() - 60000) {
                        results.push(ev);
                    }
                }
            } else if (d.start) {
                const s = new Date(d.start);
                if (s.getTime() >= now.getTime() - 60000) {
                    results.push({
                        id: docId,
                        title: d.title || "(no title)",
                        start: s,
                        end: d.end ? new Date(d.end) : null,
                        extendedProps: {
                            memo: d.memo || "",
                            x_url: d.x_url || "",
                            vrc_group_url: d.vrc_group_url || "",
                            tags: Array.isArray(d.tags) ? d.tags : [],
                            createdByName: d.createdByName || "",
                            rrule: ""
                        }
                    });
                }
            }
        } catch (e) {
            console.error("近日の予定の展開でエラー:", docId, d, e);
        }
    }

    results.sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0));

    // タグフィルター適用
    const filtered = results.filter(ev => !isHiddenByTagFilter(ev.extendedProps.tags || []));

    return filtered.slice(0, limit);
}

function renderUpcomingPanel() {
    if (!upcomingList) return;
    const events = collectUpcomingEvents(8);

    upcomingList.innerHTML = "";

    if (events.length === 0) {
        upcomingList.innerHTML = `<div class="muted">近日の予定はありません。</div>`;
        return;
    }

    for (const ev of events) {
        const tags = ev.extendedProps.tags || [];
        const who = ev.extendedProps.createdByName || "";

        const item = document.createElement("div");
        item.className = "upcoming-item";
        const pColor = primaryTagColor(tags);
        if (pColor) item.style.setProperty("--tag-color", pColor);
        item.innerHTML = `
            <div class="upcoming-date">${fmtMonthDayJaShort(ev.start)}</div>
            <div class="upcoming-time">${fmtTimeRange(ev.start, ev.end)}</div>
            <div class="upcoming-title-text">${escapeHtml(ev.title)}</div>
            <div class="muted upcoming-by">${who ? "by " + escapeHtml(who) : ""}</div>
            ${tags.length ? `<div class="upcoming-tags">${tags.map(t => `<span class="event-tag" style="--tag-color:${tagColor(t)}">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
        `;

        item.addEventListener("click", () => {
            openDayModal(new Date(ev.start));
        });

        upcomingList.appendChild(item);
    }
}

function applyUpcomingCollapsedUI() {
    if (!upcomingPanel || !upcomingToggle) return;
    if (settings.upcomingCollapsed) {
        upcomingPanel.classList.add("collapsed");
        upcomingToggle.textContent = "表示";
    } else {
        upcomingPanel.classList.remove("collapsed");
        upcomingToggle.textContent = "隠す";
    }
}

upcomingToggle?.addEventListener("click", () => {
    settings.upcomingCollapsed = !settings.upcomingCollapsed;
    saveSettings(settings);
    applyUpcomingCollapsedUI();
});

applyUpcomingCollapsedUI();
/* ===== [18] end ===== */


/* =========================================================
   [19] ICS書き出し（1件のVEVENTをダウンロード）
   ========================================================= */

// RFC5745: バックスラッシュ/カンマ/セミコロン/改行をエスケープ
function icsEscapeText(s) {
    return String(s || "")
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,")
        .replace(/\r?\n/g, "\\n");
}

// Dateを ICS の UTC形式 (YYYYMMDDTHHMMSSZ) に変換
// ※ Dateオブジェクトは内部的に実時刻(UTC基準)を保持しているので、そのまま
//    getUTC*系で取り出す（localPartsAsUTCDateはRRULE計算用の別変換なので使わない）
function toIcsUtcString(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function sanitizeFilename(name) {
    return String(name || "event")
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\s+/g, "_")
        .slice(0, 60) || "event";
}

function buildIcsForEvent(ev) {
    const docId = ev.extendedProps.parentId || ev.id;
    const occKey = ev.extendedProps.occurrenceIso || ev.id;
    const uid = `${docId}-${occKey}@vrc-calendar`;

    const start = ev.start;
    const end = ev.end || new Date(start.getTime() + 60 * 60 * 1000); // 終了未設定なら+1時間

    const url = (ev.extendedProps.vrc_group_url || ev.extendedProps.x_url || "").trim();

    const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "CALSCALE:GREGORIAN",
        "PRODID:-//vrc-calendar//calendar-app//JA",
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${toIcsUtcString(new Date())}`,
        `DTSTART:${toIcsUtcString(start)}`,
        `DTEND:${toIcsUtcString(end)}`,
        `SUMMARY:${icsEscapeText(ev.title)}`,
    ];

    if (ev.extendedProps.memo) {
        lines.push(`DESCRIPTION:${icsEscapeText(ev.extendedProps.memo)}`);
    }
    if (url) {
        lines.push(`URL:${url}`);
    }

    lines.push("END:VEVENT");
    lines.push("END:VCALENDAR");

    // ICSはCRLF区切りが仕様
    return lines.join("\r\n");
}

function downloadIcsForEvent(ev) {
    if (!ev.start) {
        alert("この予定には開始時刻がないため、書き出しできません");
        return;
    }
    const ics = buildIcsForEvent(ev);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFilename(ev.title)}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/* ===== [19] end ===== */


/* =========================================================
   [20] 通知（ブラウザNotification・タブを開いている間のみ）
   ========================================================= */
const NOTIFIED_KEY = "calendar_notified_occurrences_v1";

function getNotifiedSet() {
    try {
        const arr = JSON.parse(sessionStorage.getItem(NOTIFIED_KEY) || "[]");
        return new Set(Array.isArray(arr) ? arr : []);
    } catch {
        return new Set();
    }
}
function addNotified(id) {
    const set = getNotifiedSet();
    set.add(id);
    sessionStorage.setItem(NOTIFIED_KEY, JSON.stringify([...set]));
}

function requestNotifyPermissionIfNeeded() {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
        Notification.requestPermission();
    }
}

let notifyCheckerInterval = null;

function checkUpcomingNotifications() {
    if (!settings.notifyEnabled) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;

    const leadMs = (Number(settings.notifyMinutes) || 30) * 60000;
    const now = Date.now();
    const notified = getNotifiedSet();

    const events = collectUpcomingEvents(50);

    for (const ev of events) {
        if (!ev.start) continue;
        const diff = ev.start.getTime() - now;
        if (diff <= 0 || diff > leadMs) continue;

        const occId = ev.extendedProps.occurrenceIso
            ? `${ev.extendedProps.parentId}_${ev.extendedProps.occurrenceIso}`
            : ev.id;

        if (notified.has(occId)) continue;

        try {
            new Notification(ev.title, {
                body: `${fmtMonthDayJaShort(ev.start)} ${fmtTimeRange(ev.start, ev.end)} に開始`,
                tag: occId
            });
        } catch (e) {
            console.error("通知の表示に失敗:", e);
        }
        addNotified(occId);
    }
}

function startNotifyChecker() {
    if (notifyCheckerInterval) clearInterval(notifyCheckerInterval);
    checkUpcomingNotifications();
    notifyCheckerInterval = setInterval(checkUpcomingNotifications, 60000);
}
/* ===== [20] end ===== */
