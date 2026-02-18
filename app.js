// ===== Firebase設定（あなたのfirebaseConfigに置き換え済み前提） =====
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




// ===== ユーティリティ =====
function qs(id) { return document.getElementById(id); }

function toDatetimeLocalValue(date) {
    // date: Date
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
    return z.toISOString().slice(0, 19); // "YYYY-MM-DDTHH:mm:ss"
}

function localIsoNoZToDate(s) {
    // "YYYY-MM-DDTHH:mm:ss" -> Date(ローカル)
    const [d, t] = s.split("T");
    const [y, m, day] = d.split("-").map(Number);
    const [hh, mm, ss] = t.split(":").map(Number);
    return new Date(y, m - 1, day, hh, mm, ss || 0, 0);
}



// ===== 設定（localStorage） =====
const LS_KEY = "calendar_settings_v1";
const defaultSettings = {
    name: "名無し",
    weekStart: 0,               // 0:日 1:月
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

// ===== Auth（匿名ログイン）=====
let currentUser = null;

firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) {
        await firebase.auth().signInAnonymously();
        return; // ここで終了。次の onAuthStateChanged で user が入る
    }
    currentUser = user;

    // ここで初めて「ログイン済み」になる
    console.log("Signed in:", user.uid);

    // （任意）ユーザー名が未設定なら uid の一部で仮名を入れる
    if (!settings.name || settings.name === "名無し") {
        settings.name = "user-" + user.uid.slice(0, 6);
        saveSettings(settings);
    }

    // ★重要：ログイン後に購読開始
    startEventsSubscription();
});

// ===== モーダル関連（予定） =====
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
function getSelectedNth() {
    return [...document.querySelectorAll(".nth:checked")]
        .map(el => el.value); // "1","3","-1" など
}

//console_wlite


const f_weekday = qs("f_weekday");
const dayModal = qs("dayModal");
const dayTitle = qs("dayTitle");
const dayList = qs("dayList");
const dayClose = qs("dayClose");
const dayAdd = qs("dayAdd");

let activeDayDate = null; // Date

// 5分刻み（=300秒）
f_start.setAttribute("step", "300");
f_end.setAttribute("step", "300");



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
    const e = fmtTime(end);
    return `${s}～${e}`;
}


function fmtYMDJa(d) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return `${y}年${m}月${day}日`;
}

function openDayModal(date) {
    activeDayDate = date;
    dayTitle.textContent = `${fmtYMDJa(date)} の予定（時刻順）`;

    // その日のイベントを集める（FullCalendar内から）
    const events = calendar.getEvents()
        .filter(ev => ev.start && isSameYMD(ev.start, date))
        .sort((a, b) => {
            // 終日の扱い：startが00:00は先に来がちなので、必要なら調整可
            return (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0);
        });

    // 一覧描画
    dayList.innerHTML = "";

    if (events.length === 0) {
        dayList.innerHTML = `<div class="muted">この日の予定はありません。</div>`;
    } else {
        for (const ev of events) {
            const tags = (ev.extendedProps.tags || []).join(" / ");
            const who = ev.extendedProps.createdByName || "";
            const xurl = ev.extendedProps.x_url || "";

            const item = document.createElement("div");
            item.className = "day-item";

            // ★この1行を「item.innerHTML の直前」に追加
            const isOccurrence = !!ev.extendedProps.parentId && !!ev.extendedProps.occurrenceIso;

            item.innerHTML = `
            <div class="day-item-top">
            <div class="day-time">${fmtTimeRange(ev.start, ev.end)}</div>
            <div class="day-title">${escapeHtml(ev.title)}</div>
            <div class="muted">${who ? "by " + escapeHtml(who) : ""}</div>
            </div>
            ${tags ? `<div class="day-tags">タグ: ${escapeHtml(tags)}</div>` : ""}
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
                    closeDayModal(); // ★一覧を閉じてから編集画面へ
                    // 編集モーダルへ（一覧→編集）
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
                            rrule: ev.extendedProps.rrule || "", // ★追加
                            parentId: ev.extendedProps.parentId || "",
                            occurrenceIso: ev.extendedProps.occurrenceIso || ""
                        }
                    });

                    return;
                }
                // ★この回だけ削除（exdates に追加）
                if (act === "del-one") {
                    const parentId = ev.extendedProps.parentId;
                    const occIso = ev.extendedProps.occurrenceIso;
                    if (!parentId || !occIso) return;

                    if (!confirm("この回だけ削除する？（シリーズは残ります）")) return;

                    await db.collection("events").doc(parentId).update({
                        exdates: firebase.firestore.FieldValue.arrayUnion(occIso),
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });

                    // 一覧を作り直し
                    openDayModal(new Date(activeDayDate));
                    return;
                }

                // ★シリーズ全体削除（本体doc削除）
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
dayModal?.addEventListener("click", (e) => {
    if (e.target === dayModal) closeDayModal();
});

dayAdd?.addEventListener("click", () => {
    const d = activeDayDate ? new Date(activeDayDate) : new Date();
    // デフォルトは 12:00 とかにしたいならここで setHours
    openEventModal({
        mode: "new",
        docId: null,
        data: { createdByName: settings.name || "名無し", tags: [] },
        startDate: d
    });
});



// 全イベントからタグを集計して保持
let globalTagSet = new Set();

function rebuildTagPalette() {
    if (!tagPalette) return;
    tagPalette.innerHTML = "";

    // 設定のタグ候補（ローカル）＋ 全体タグ（Firestore） を合体
    const presetTags = parseTags(settings.tagPresets || "");
    const all = new Set([...presetTags, ...globalTagSet]);

    [...all].sort((a, b) => a.localeCompare(b, 'ja')).forEach(tag => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "tag-chip";
        btn.textContent = tag;

        btn.addEventListener("click", () => {
            const current = new Set(parseTags(f_tags.value));
            if (current.has(tag)) {
                current.delete(tag); // もう一回押すと外す（好みで）
            } else {
                current.add(tag);
            }
            f_tags.value = [...current].join(",");
            btn.classList.toggle("active");
        });

        tagPalette.appendChild(btn);
    });
}


let activeEventId = null; // Firestore doc id

let activeParentId = null;
let activeOccurrenceIso = null;
let lastDurationMs = 60 * 60 * 1000; // デフォルト1時間


function openEventModal({ mode, docId, data, startDate }) {
    eventModalMode = mode; // ★追加
    const existingRrule = data?.rrule || "";
    // mode: "new" | "edit"
    activeEventId = docId || null;
    activeParentId = data?.parentId || null;
    activeOccurrenceIso = data?.occurrenceIso || null;


    qs("modalTitle").textContent = (mode === "new") ? "予定を追加" : "予定を編集";

    f_title.value = data?.title || "";
    f_memo.value = data?.memo || "";
    f_xurl.value = data?.x_url || "";
    f_tags.value = (data?.tags || []).join(",");

    // datetime-localはローカル時間の文字列が必要
    const start = data?.start ? new Date(data.start) : (startDate || new Date());
    f_start.value = toDatetimeLocalValue(start);

    if (data?.end) {
        f_end.value = toDatetimeLocalValue(new Date(data.end));
    } else {
        f_end.value = "";
    }
    const s = new Date(f_start.value);
    const e = f_end.value ? new Date(f_end.value) : null;
    lastDurationMs = e ? (e.getTime() - s.getTime()) : (60 * 60 * 1000);


    f_creator.textContent = data?.createdByName || "(不明)";

    // 新規追加時は削除ボタンを隠す
    btnDelete.style.display = (mode === "new") ? "none" : "inline-block";

    eventModal.classList.remove("hidden");
    rebuildTagPalette();

    document.body.classList.add("modal-open");
    updateRepeatUI(); // これも入れておくと繰り返しUIが正しく出る

}

function closeEventModal() {
    eventModal.classList.add("hidden");
    activeEventId = null;
    document.body.classList.remove("modal-open");

}

btnClose.addEventListener("click", closeEventModal);
eventModal.addEventListener("click", (e) => {
    if (e.target !== eventModal) return;

    // ★新規追加のときは閉じない
    if (eventModalMode === "new") return;

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



function getNthOfDateInMonth(date) {
    // date がその月の「第何回目の曜日」か（1..4 or -1 最終）を返す
    const y = date.getFullYear();
    const m = date.getMonth();
    const weekday = date.getDay();

    // その曜日の1回目
    const first = new Date(y, m, 1);
    const diff = (weekday - first.getDay() + 7) % 7;
    const firstOccur = 1 + diff;

    const nth = Math.floor((date.getDate() - firstOccur) / 7) + 1;

    // 最終かどうか判定（同じ曜日で7日後が同月に存在しない）
    const next = new Date(y, m, date.getDate() + 7);
    const isLast = next.getMonth() !== m;

    return isLast ? -1 : nth;
}

// 「ローカルの見た目(年月日時分)」をそのまま UTC として扱う Date を作る
function localPartsAsUTCDate(d) {
    return new Date(Date.UTC(
        d.getFullYear(), d.getMonth(), d.getDate(),
        d.getHours(), d.getMinutes(), d.getSeconds() || 0, 0
    ));
}

// rruleが返す Date(UTC基準) を「UTCの部品 = ローカルの部品」として復元
function utcPartsToLocalDate(dt) {
    return new Date(
        dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(),
        dt.getUTCHours(), dt.getUTCMinutes(), dt.getUTCSeconds(), 0
    );
}

// 保存（新規 or 更新）
btnSave.addEventListener("click", async () => {
    const title = f_title.value.trim();
    if (!title) return alert("タイトル必須");

    // 入力値は「ローカル」として扱う
    const startLocal = new Date(f_start.value);
    const endLocal = f_end.value ? new Date(f_end.value) : null;

    const payload = {
        title,
        start: toLocalIsoNoZ(startLocal),                 // ★常にローカルISOで保存
        end: endLocal ? toLocalIsoNoZ(endLocal) : "",     // ★常にローカルISOで保存
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

        const weekdayIndex = startLocal.getDay();
        const wd = weekdayToRRule(weekdayIndex);

        // ★クリック日の曜日固定 + 第◯指定（開始日は補正しない）
        rrule = `FREQ=MONTHLY;BYDAY=${wd};BYSETPOS=${nthList.join(",")}`;
    }

    payload.rrule = rrule;

    // --- 以下はあなたの既存処理のままでOK（overrides / add / update） ---
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
        if (!dayModal.classList.contains("hidden") && activeDayDate) {
            openDayModal(new Date(activeDayDate));
        }
        return;
    }

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
    if (!dayModal.classList.contains("hidden") && activeDayDate) {
        openDayModal(new Date(activeDayDate));
    }
});


function weekdayToRRule(dayIndex) {
    // JS: 0=日..6=土 → RRULE: SU..SA
    return ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][dayIndex];
}

function nthWeekdayDateOfMonth(baseDate, nth, weekdayIndex) {
    // baseDate の「同じ月」で nth回目の weekdayIndex(0..6) の日付を返す
    const y = baseDate.getFullYear();
    const m = baseDate.getMonth();

    if (nth > 0) {
        const first = new Date(y, m, 1);
        const diff = (weekdayIndex - first.getDay() + 7) % 7;
        const day = 1 + diff + (nth - 1) * 7;
        return new Date(y, m, day, baseDate.getHours(), baseDate.getMinutes(), 0, 0);
    } else {
        // nth = -1（最終）
        const last = new Date(y, m + 1, 0);
        const diff = (last.getDay() - weekdayIndex + 7) % 7;
        const day = last.getDate() - diff;
        return new Date(y, m, day, baseDate.getHours(), baseDate.getMinutes(), 0, 0);
    }
}



// 削除
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

// ===== 設定モーダル =====
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
settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) closeSettingsModal();
});

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

    // 設定反映：週開始＆初期ビューは再描画が必要なのでリロードするのが簡単
    location.reload();
});

// ===== FullCalendar =====
const calendarEl = document.getElementById("calendar");

const calendar = new FullCalendar.Calendar(calendarEl, {
    timeZone: "local",
    dayMaxEventRows: false,
    locale: 'ja',
    initialView: settings.initialView,
    firstDay: settings.weekStart,
    selectable: true,
    nowIndicator: true,
    showNonCurrentDates: false,  // 前月/翌月の日付を表示しない
    fixedWeekCount: false,       // 常に6週固定をやめる（必要な週だけ表示）
    height: "auto",          // ★カレンダー全体を自動高さ
    contentHeight: "auto",   // ★中身も自動高さ
    expandRows: true,        // ★月表示の行をちゃんと伸ばす
    fixedWeekCount: false,   // ★その月に必要な週だけ表示（6週固定をやめる）


    dateClick(info) {
        openDayModal(info.date);
    },

    eventClick(info) {
        openDayModal(info.event.start);
    },

    // タイトル＋タグ＋追加者を表示
    eventContent(arg) {
        const tags = arg.event.extendedProps.tags || [];
        const who = arg.event.extendedProps.createdByName || "";

        const wrap = document.createElement("div");
        wrap.style.fontSize = "12px";
        wrap.style.lineHeight = "1.25";

        // タイトル
        const t = document.createElement("div");
        t.innerHTML = `<b>${escapeHtml(arg.event.title)}</b>`;
        wrap.appendChild(t);

        // ★タグ（色付きバッジ）
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

        // 追加者
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

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function expandRRuleToEvents(docId, d, rangeStart, rangeEnd) {
    const RRuleClass = window.RRule || (window.rrule && window.rrule.RRule);
    if (!RRuleClass) return [];

    // Firestoreの "YYYY-MM-DDTHH:mm:ss" は local として読む
    const baseStartLocal = new Date(d.start);
    const baseEndLocal = d.end ? new Date(d.end) : null;

    const durationMs = baseEndLocal ? (baseEndLocal.getTime() - baseStartLocal.getTime()) : 0;

    const opts = RRuleClass.parseString(d.rrule);

    // ★RRULE計算用の dtstart は「ローカル部品をUTCとして固定」する
    opts.dtstart = localPartsAsUTCDate(baseStartLocal);

    // between の range も同じ思想で揃える
    const rangeStartUTC = localPartsAsUTCDate(rangeStart);
    const rangeEndUTC = localPartsAsUTCDate(rangeEnd);

    const rule = new RRuleClass(opts);
    const datesUTC = rule.between(rangeStartUTC, rangeEndUTC, true);

    const exdates = new Set(Array.isArray(d.exdates) ? d.exdates : []);
    const overrides = (d.overrides && typeof d.overrides === "object") ? d.overrides : {};

    return datesUTC.map((dtUTC) => {
        // ★RRULE結果(UTC基準)を「UTC部品=ローカル部品」で復元
        const sLocal = utcPartsToLocalDate(dtUTC);

        const occKey = toLocalIsoNoZ(sLocal); // "YYYY-MM-DDTHH:mm:ss"
        if (exdates.has(occKey)) return null;

        const ov = overrides[occKey] || {};

        let eLocal = null;
        if (durationMs) eLocal = new Date(sLocal.getTime() + durationMs);

        return {
            id: `${docId}_${occKey}`,
            title: ov.title ?? d.title ?? "(no title)",
            // ★FullCalendarには Date を渡す（文字列パースの罠回避）
            start: ov.start ? localIsoNoZToDate(ov.start) : sLocal,
            end: ov.end ? localIsoNoZToDate(ov.end) : eLocal,
            extendedProps: {
                memo: ov.memo ?? (d.memo || ""),
                x_url: ov.x_url ?? (d.x_url || ""),
                tags: ov.tags ?? (Array.isArray(d.tags) ? d.tags : []),
                createdByName: d.createdByName || "",
                parentId: docId,
                occurrenceIso: occKey,
                rrule: d.rrule || "",

            }

        };

        function localIsoNoZToDate(s) {
            // "YYYY-MM-DDTHH:mm:ss" -> Date(ローカル)
            const [d, t] = s.split("T");
            const [y, m, day] = d.split("-").map(Number);
            const [hh, mm, ss] = t.split(":").map(Number);
            return new Date(y, m - 1, day, hh, mm, ss || 0, 0);
        }


    }).filter(Boolean);
}






// ===== Firestore リアルタイム購読 =====
// 追加：購読解除用
let unsubscribeEvents = null;

// 追加：購読開始関数（ログイン後に呼ぶ）
function startEventsSubscription() {
    // 二重購読防止
    if (unsubscribeEvents) unsubscribeEvents();

    unsubscribeEvents = db.collection("events").orderBy("createdAt", "desc").onSnapshot((snapshot) => {
        calendar.removeAllEvents();
        globalTagSet = new Set();

        // ★表示範囲（1回だけ計算）
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
                // rruleがあるなら展開して複数追加
                if (d.rrule) {
                    const expanded = expandRRuleToEvents(doc.id, d, rangeStart, rangeEnd);
                    for (const ev of expanded) calendar.addEvent(ev);
                } else {
                    // 通常の単発予定
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

