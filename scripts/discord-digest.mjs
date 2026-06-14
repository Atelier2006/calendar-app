// Discordに「今日・明日の予定」を定期投稿するスクリプト。
// GitHub Actions の cron から実行される想定。
//
// 必要な環境変数:
//   DISCORD_WEBHOOK_URL ... Discordのチャンネルに設定したWebhook URL
//
// 仕組み:
//   1. アプリ本体と同じ匿名ログイン(Firebase Auth REST API)でIDトークンを取得
//   2. Firestore REST APIで events コレクションを取得
//   3. 繰り返し予定(RRULE)をJST基準で展開し、「今日」「明日」に該当するものを抽出
//   4. Discord Webhookにメッセージを投稿
//
// ※ 日付計算はすべて「日本時間(JST, UTC+9)」を前提にしている
//    (GitHub Actionsの実行環境はUTCのため、明示的にJSTへ変換して扱う)

import { RRule } from "rrule";

const FIREBASE_API_KEY = "AIzaSyBrO_NQFJ0ydJ7Q2PplQ-HvaYRcrBwT-cc";
const PROJECT_ID = "calendar-d5e4a";
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/* ===== Firestore REST 値変換 ===== */
function fsValueToJs(v) {
    if (!v) return null;
    if ("stringValue" in v) return v.stringValue;
    if ("integerValue" in v) return parseInt(v.integerValue, 10);
    if ("doubleValue" in v) return v.doubleValue;
    if ("booleanValue" in v) return v.booleanValue;
    if ("nullValue" in v) return null;
    if ("timestampValue" in v) return v.timestampValue;
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(fsValueToJs);
    if ("mapValue" in v) return fsFieldsToJs(v.mapValue.fields || {});
    return null;
}
function fsFieldsToJs(fields) {
    const out = {};
    for (const [k, v] of Object.entries(fields || {})) out[k] = fsValueToJs(v);
    return out;
}

/* ===== JST <-> RRule計算用「擬似UTC」変換 =====
   ※ アプリ側(app.js)の localPartsAsUTCDate / utcPartsToLocalDate と同じ考え方。
      JSTの壁時計の値をそのままUTCのDateとして扱うことで、RRuleのタイムゾーン非依存計算を簡略化する。 */
function parseIsoParts(s) {
    const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: m[6] ? +m[6] : 0 };
}
function jstPartsAsUtcDate(p) {
    return new Date(Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s));
}
function fakeUtcToRealUtc(fakeUtcDate) {
    return new Date(fakeUtcDate.getTime() - JST_OFFSET_MS);
}
function fakeUtcToIsoNoZ(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
function jstStringToRealUtc(s) {
    const p = parseIsoParts(s);
    if (!p) return null;
    return fakeUtcToRealUtc(jstPartsAsUtcDate(p));
}
function fmtJstTime(d) {
    const jst = new Date(d.getTime() + JST_OFFSET_MS);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`;
}
function fmtJstDate(d) {
    const jst = new Date(d.getTime() + JST_OFFSET_MS);
    const wd = ["日", "月", "火", "水", "木", "金", "土"][jst.getUTCDay()];
    return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}(${wd})`;
}

/* ===== Firebase 匿名認証 ===== */
async function getIdToken() {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnSecureToken: true })
    });
    const data = await res.json();
    if (!data.idToken) throw new Error("匿名ログインに失敗しました: " + JSON.stringify(data));
    return data.idToken;
}

/* ===== Firestore からイベント一覧を取得 ===== */
async function fetchEventDocs(idToken) {
    const docs = [];
    let pageToken;
    do {
        const url = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/events`);
        url.searchParams.set("pageSize", "300");
        if (pageToken) url.searchParams.set("pageToken", pageToken);

        const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
        const data = await res.json();
        if (!res.ok) throw new Error("Firestoreの取得に失敗しました: " + JSON.stringify(data));

        for (const doc of (data.documents || [])) {
            docs.push(fsFieldsToJs(doc.fields));
        }
        pageToken = data.nextPageToken;
    } while (pageToken);
    return docs;
}

/* ===== イベント展開（今日・明日の範囲のみ） ===== */
function expandEvent(d, rangeStartFake, rangeEndFake) {
    const results = [];

    if (d.rrule && d.start) {
        const startParts = parseIsoParts(d.start);
        if (!startParts) return results;
        const dtstartFake = jstPartsAsUtcDate(startParts);

        const endParts = d.end ? parseIsoParts(d.end) : null;
        const durationMs = endParts ? (jstPartsAsUtcDate(endParts).getTime() - dtstartFake.getTime()) : 0;

        let rule;
        try {
            const opts = RRule.parseString(d.rrule);
            opts.dtstart = dtstartFake;
            rule = new RRule(opts);
        } catch {
            return results;
        }

        const occurrencesFake = rule.between(rangeStartFake, rangeEndFake, true);
        const exdates = new Set(Array.isArray(d.exdates) ? d.exdates : []);
        const overrides = (d.overrides && typeof d.overrides === "object") ? d.overrides : {};

        for (const occFake of occurrencesFake) {
            const occKey = fakeUtcToIsoNoZ(occFake);
            if (exdates.has(occKey)) continue;
            const ov = overrides[occKey] || {};

            const startFake = ov.start ? jstPartsAsUtcDate(parseIsoParts(ov.start)) : occFake;
            const endFake = ov.end
                ? jstPartsAsUtcDate(parseIsoParts(ov.end))
                : (durationMs ? new Date(occFake.getTime() + durationMs) : null);

            results.push({
                title: ov.title ?? d.title ?? "(無題)",
                startUtc: fakeUtcToRealUtc(startFake),
                endUtc: endFake ? fakeUtcToRealUtc(endFake) : null,
                tags: ov.tags ?? (Array.isArray(d.tags) ? d.tags : []),
                createdByName: d.createdByName || ""
            });
        }
        return results;
    }

    if (d.start) {
        const startUtc = jstStringToRealUtc(d.start);
        if (!startUtc) return results;
        const rangeStartReal = fakeUtcToRealUtc(rangeStartFake);
        const rangeEndReal = fakeUtcToRealUtc(rangeEndFake);
        if (startUtc.getTime() < rangeStartReal.getTime() || startUtc.getTime() >= rangeEndReal.getTime()) {
            return results;
        }
        results.push({
            title: d.title || "(無題)",
            startUtc,
            endUtc: d.end ? jstStringToRealUtc(d.end) : null,
            tags: Array.isArray(d.tags) ? d.tags : [],
            createdByName: d.createdByName || ""
        });
    }

    return results;
}

/* ===== Discordへの投稿メッセージ作成 ===== */
function formatEventLine(ev) {
    const time = ev.endUtc
        ? `${fmtJstTime(ev.startUtc)}-${fmtJstTime(ev.endUtc)}`
        : fmtJstTime(ev.startUtc);
    const tags = ev.tags.length ? ` \`${ev.tags.join("\` \`")}\`` : "";
    const who = ev.createdByName ? `（${ev.createdByName}）` : "";
    return `・**${time}** ${ev.title}${tags}${who}`;
}

function buildMessage(todayEvents, tomorrowEvents, todayDate, tomorrowDate) {
    const lines = [];
    lines.push(`📅 **${fmtJstDate(todayDate)} の予定**`);
    if (todayEvents.length === 0) {
        lines.push("・予定はありません");
    } else {
        for (const ev of todayEvents) lines.push(formatEventLine(ev));
    }

    lines.push("");
    lines.push(`📅 **${fmtJstDate(tomorrowDate)}（明日）の予定**`);
    if (tomorrowEvents.length === 0) {
        lines.push("・予定はありません");
    } else {
        for (const ev of tomorrowEvents) lines.push(formatEventLine(ev));
    }

    return lines.join("\n");
}

/* ===== メイン処理 ===== */
async function main() {
    if (!WEBHOOK_URL) {
        throw new Error("環境変数 DISCORD_WEBHOOK_URL が設定されていません。");
    }

    const idToken = await getIdToken();
    const eventDocs = await fetchEventDocs(idToken);

    const nowRealUtc = new Date();
    const nowJst = new Date(nowRealUtc.getTime() + JST_OFFSET_MS);
    const todayStartFake = new Date(Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate(), 0, 0, 0));
    const tomorrowStartFake = new Date(todayStartFake.getTime() + 24 * 60 * 60 * 1000);
    const dayAfterTomorrowStartFake = new Date(todayStartFake.getTime() + 2 * 24 * 60 * 60 * 1000);

    const todayEvents = [];
    const tomorrowEvents = [];

    for (const d of eventDocs) {
        const expanded = expandEvent(d, todayStartFake, dayAfterTomorrowStartFake);
        for (const ev of expanded) {
            const startFake = new Date(ev.startUtc.getTime() + JST_OFFSET_MS);
            if (startFake.getTime() < tomorrowStartFake.getTime()) {
                todayEvents.push(ev);
            } else {
                tomorrowEvents.push(ev);
            }
        }
    }

    todayEvents.sort((a, b) => a.startUtc - b.startUtc);
    tomorrowEvents.sort((a, b) => a.startUtc - b.startUtc);

    const todayDateReal = fakeUtcToRealUtc(todayStartFake);
    const tomorrowDateReal = fakeUtcToRealUtc(tomorrowStartFake);
    const content = buildMessage(todayEvents, tomorrowEvents, todayDateReal, tomorrowDateReal);

    const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Discordへの投稿に失敗しました (${res.status}): ${body}`);
    }

    console.log("投稿完了:\n" + content);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});