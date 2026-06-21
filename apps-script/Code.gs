/**
 * ============================================================================
 * ACC Oil Lubrication System — Google Apps Script Backend
 * ============================================================================
 *
 * Replaces the Node/Express + Prisma backend entirely. The React/Vite
 * frontend talks directly to this Web App over HTTPS; this script reads and
 * writes the two existing Google Sheets workbooks (Operational Data, Users &
 * Config) as the application's database. No Node server, no Postgres/SQLite,
 * no Firebase/Supabase.
 *
 * ARCHITECTURE
 *   Instead of mimicking REST paths, the frontend calls one Web App URL with
 *   a function name ("fn") + parameters. doGet/doPost route to the matching
 *   handler below. This keeps the whole backend in a single addressable
 *   file, which is the natural shape for Apps Script (no router framework
 *   available) and avoids the CORS preflight problems that a path-based
 *   REST-over-Apps-Script design runs into (see DEPLOYMENT_GUIDE.md).
 *
 * DATA MODEL
 *   This script does NOT redesign the spreadsheet. It reads the tabs exactly
 *   as they already exist in ACC_Oil_Operational_Data.xlsx and
 *   ACC_Oil_Users_Config.xlsx (902 existing lubrication points, 1,102
 *   existing history rows — never touched on read, only appended to or
 *   patched by id on write). The only schema change this script requires is
 *   two ADDITIONAL columns on the existing "Users" tab — "Password Hash" and
 *   "Password Salt" — needed because the previous architecture kept
 *   passwords in Postgres, outside the spreadsheet. See
 *   DEPLOYMENT_GUIDE.md "Manual setup" for the one-time step this requires.
 *
 * SETUP — see DEPLOYMENT_GUIDE.md for the full walkthrough. Summary:
 *   1. Script Properties (Project Settings -> Script Properties):
 *        OPERATIONAL_SHEET_ID = 1PvWrm5Sf1w3o3yIil_YWiwwQNrUDH_JRNB_gJqZsYFY
 *        CONFIG_SHEET_ID      = 1r9ZOBsy5Ml_rGZe8vvneDv4VyLm90S8eDERWze80MzY
 *        TOKEN_SECRET         = <any long random string — signs session tokens>
 *   2. Run `bootstrapAddPasswordColumns` once from the Apps Script editor
 *      (adds the two new columns to Users if they don't already exist).
 *   3. Run `adminSetPassword_("email@x.com", "TempPass123!")` once per user
 *      (or use the "ACC Oil Admin" menu added to the bound Sheet's UI) to
 *      give every existing account an initial password.
 *   4. Deploy -> New deployment -> Web app -> Execute as "Me", Access
 *      "Anyone". Copy the /exec URL into the frontend's VITE_APPS_SCRIPT_URL.
 *
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────

var PROPS = PropertiesService.getScriptProperties();

var BOOK = { OPERATIONAL: 'operational', CONFIG: 'config' };

var SHEETS = {
  LUBRICATION_POINTS: 'Lubrication Points',
  LUBRICATION_HISTORY: 'Lubrication History',
  OIL_SAMPLES: 'Oil Samples',
  OIL_SAMPLE_PARAMETERS: 'Oil Sample Parameters',
  ACTION_PLANS: 'Action Plans',
  ROUTES: 'Routes',
  ROUTE_ASSIGNMENTS: 'Route Assignments',
  ROUTE_EXECUTION_LOG: 'Route Execution Log',
  NOTIFICATIONS: 'Notifications',
  AUDIT_LOG: 'Audit Log',
  OIL_PURCHASE_LOG: 'Oil Purchase Log',
  USERS: 'Users',
  TITLES: 'Titles',
  PERMISSION_TEMPLATES: 'Permission Templates',
  ORGANIZATIONS: 'Organizations',
  EQUIPMENT: 'Equipment',
  AREAS: 'Areas',
  LUBRICANT_TYPES: 'Lubricant Types',
  ACTION_TYPES: 'Action Types',
  NOTIFICATION_TYPES: 'Notification Types & Routing',
  GENERAL_SETTINGS: 'General Settings'
};

// Token lifetime. Mirrors the old JWT_EXPIRES_IN / JWT_MOBILE_EXPIRES_IN split.
var TOKEN_TTL_MS = 8 * 60 * 60 * 1000;        // 8 hours, desktop
var TOKEN_TTL_MOBILE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, mobile

// ─────────────────────────────────────────────────────────────────────────
// WEB APP ENTRY POINTS
// ─────────────────────────────────────────────────────────────────────────

function doGet(e) {
  return handleRequest_(e, false);
}

function doPost(e) {
  return handleRequest_(e, true);
}

/**
 * Single entry point for both verbs. The frontend always sends:
 *   GET  ...?fn=getDashboardData&token=...&p=<url-encoded JSON params>
 *   POST body: { "fn": "...", "token": "...", "params": {...} }
 * (POST bodies are sent as text/plain, not application/json, specifically
 * to avoid a CORS preflight — see DEPLOYMENT_GUIDE.md "Why fn-routing".)
 */
function handleRequest_(e, isPost) {
  var fn, token, params;
  try {
    if (isPost) {
      var body = JSON.parse((e.postData && e.postData.contents) || '{}');
      fn = body.fn;
      token = body.token;
      params = body.params || {};
    } else {
      var q = (e && e.parameter) || {};
      fn = q.fn;
      token = q.token;
      params = q.p ? JSON.parse(q.p) : {};
    }

    var entry = FUNCTION_MAP[fn];
    if (!entry) return jsonOut_({ ok: false, error: 'Unknown function: ' + fn });

    var user = null;
    if (entry.auth !== false) {
      user = requireAuth_(token);
      if (entry.screen) requireScreen_(user, entry.screen);
      if (entry.capability) requireCapability_(user, entry.capability);
    }

    var result = entry.handler(params || {}, user);
    return jsonOut_({ ok: true, data: result });
  } catch (err) {
    var status = err && err.httpStatus ? err.httpStatus : 500;
    return jsonOut_({ ok: false, error: (err && err.message) || String(err), status: status });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Throws a tagged error so the client can distinguish 401/403/404/400 from generic 500s. */
function apiError_(status, message) {
  var e = new Error(message);
  e.httpStatus = status;
  return e;
}

// ─────────────────────────────────────────────────────────────────────────
// SHEET I/O — generic table read/write helpers
// ─────────────────────────────────────────────────────────────────────────

function getSpreadsheetId_(book) {
  if (book === BOOK.OPERATIONAL) return PROPS.getProperty('OPERATIONAL_SHEET_ID');
  if (book === BOOK.CONFIG) return PROPS.getProperty('CONFIG_SHEET_ID');
  throw new Error("Unknown book: " + book);
}

function getSpreadsheet_(book) {
  var id = getSpreadsheetId_(book);
  if (!id) throw new Error('Script property missing for book "' + book + '". Set OPERATIONAL_SHEET_ID / CONFIG_SHEET_ID in Script Properties.');
  return SpreadsheetApp.openById(id);
}

function getSheet_(book, sheetName) {
  var ss = getSpreadsheet_(book);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: "' + sheetName + '" in ' + book + ' workbook.');
  return sheet;
}

// Workbooks put a single-cell note in A1 (blank row 2, real header row 3) on
// tabs that carry an explanatory note, and a plain header in row 1 on tabs
// that don't. Detect which pattern this sheet uses — same convention as the
// original starting-point Code.gs.
function findHeaderRow_(sheet) {
  if (sheet.getLastColumn() === 0) return 1;
  var row1 = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row1Populated = row1.filter(function (v) { return v !== '' && v !== null; }).length;
  return row1Populated > 1 ? 1 : 3;
}

/** Reads a whole tab into { headers, headerRow, rows: [{col: val, ..., __row}] }. */
function readTable_(sheet) {
  var headerRow = findHeaderRow_(sheet);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var headers = lastCol > 0 ? sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0] : [];
  var rows = [];
  if (lastRow > headerRow) {
    var data = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      var obj = {};
      for (var c = 0; c < headers.length; c++) {
        if (headers[c]) obj[headers[c]] = r[c];
      }
      obj.__row = headerRow + 1 + i;
      // Skip fully-blank rows (trailing blank rows some sheets carry).
      var hasValue = false;
      for (var k = 0; k < headers.length; k++) {
        var hv = obj[headers[k]];
        if (hv !== '' && hv !== null && hv !== undefined) { hasValue = true; break; }
      }
      if (hasValue) rows.push(obj);
    }
  }
  return { headers: headers, headerRow: headerRow, rows: rows };
}

/** Shorthand: book+sheet -> rows array (most callers only need this). */
function readRows_(book, sheetName) {
  return readTable_(getSheet_(book, sheetName)).rows;
}

function appendRowObj_(book, sheetName, rowObj) {
  var sheet = getSheet_(book, sheetName);
  var table = readTable_(sheet);
  var newRow = table.headers.map(function (h) {
    if (!h) return '';
    var v = rowObj[h];
    return v === undefined || v === null ? '' : v;
  });
  sheet.appendRow(newRow);
  SpreadsheetApp.flush();
  return rowObj;
}

/** Updates the first row where keyColumn === keyValue. Returns the updated row's __row, or null. */
function updateRowByKey_(book, sheetName, keyColumn, keyValue, updates) {
  var sheet = getSheet_(book, sheetName);
  var table = readTable_(sheet);
  var match = null;
  for (var i = 0; i < table.rows.length; i++) {
    if (String(table.rows[i][keyColumn]) === String(keyValue)) { match = table.rows[i]; break; }
  }
  if (!match) return null;
  Object.keys(updates).forEach(function (field) {
    var colIdx = table.headers.indexOf(field);
    if (colIdx === -1) return;
    sheet.getRange(match.__row, colIdx + 1).setValue(updates[field]);
  });
  SpreadsheetApp.flush();
  return match.__row;
}

/** Generates the next sequential id for a prefix, e.g. nextSequentialId_('operational','Action Plans','Action ID','ACT-',5) -> "ACT-00042". */
function nextSequentialId_(book, sheetName, idColumn, prefix, padLength) {
  var rows = readRows_(book, sheetName);
  var max = 0;
  rows.forEach(function (r) {
    var v = String(r[idColumn] || '');
    if (v.indexOf(prefix) === 0) {
      var n = parseInt(v.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  });
  var next = max + 1;
  var s = String(next);
  while (s.length < padLength) s = '0' + s;
  return prefix + s;
}

/**
 * Runs fn() while holding a script-wide lock. Apps Script Web App requests
 * from different users can execute concurrently — without this, two
 * technicians submitting at the same moment could both read the same "max
 * existing id" and append rows with the SAME generated id (e.g. two
 * different Lubrication History rows both as "REC-01103"), which would
 * silently corrupt lookups, approvals, and audit trails that key off that
 * id. Every call site that does nextSequentialId_() immediately followed
 * by appendRowObj_() wraps both inside this lock so the read-then-append
 * is atomic. Waits up to 30s for the lock before giving up (returns a
 * clear error rather than hanging silently).
 */
function withScriptLock_(fn) {
  var lock = LockService.getScriptLock();
  var got = lock.tryLock(30000);
  if (!got) throw apiError_(503, 'The system is busy — please try again in a few seconds.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function toIso_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    var d = new Date(v);
    return isNaN(d.getTime()) ? v : d.toISOString();
  }
  return v;
}

function toDateOrNull_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function boolFromYesNo_(v) {
  if (typeof v === 'boolean') return v;
  var s = String(v || '').trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1';
}

function yesNo_(b) { return b ? 'Yes' : 'No'; }

// ─────────────────────────────────────────────────────────────────────────
// AUTH & SECURITY
// ─────────────────────────────────────────────────────────────────────────

/** Constant-time string comparison — mitigates timing side-channel attacks
 * on signature/hash verification (a naive `===`/`!==` compare can leak how
 * many leading characters matched via response-time differences). */
function timingSafeEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var result = 0;
  for (var i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function bytesToHex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

/** Number of HMAC rounds applied when hashing a password. Apps Script has
 * no bcrypt/scrypt/native PBKDF2, so this hand-rolls equivalent key
 * stretching by chaining HMAC-SHA256: a single unsalted-work-factor SHA-256
 * pass computes in microseconds, which means an offline attacker with a
 * leaked Users tab could try billions of password guesses per second per
 * GPU. Iterating thousands of rounds adds real but small latency to one
 * legitimate login (a few hundred ms at most) while making the same
 * offline attack thousands of times slower. Raise this over time as
 * hardware gets faster; lower it only if login latency becomes a problem.
 * NOTE: changing this constant changes the hash format — any passwords
 * already set with a different value need to be reset via
 * adminSetPassword_ afterward, since old hashes won't verify under a new
 * iteration count. */
var PASSWORD_HASH_ITERATIONS = 10000;

/** Iterated HMAC-SHA256(salt, password), hex-encoded — see
 * PASSWORD_HASH_ITERATIONS above for why this isn't a single digest pass. */
function hashPassword_(password, salt) {
  var data = 'v1:' + password;
  var hex;
  for (var i = 0; i < PASSWORD_HASH_ITERATIONS; i++) {
    hex = bytesToHex_(Utilities.computeHmacSha256Signature(data, salt));
    data = hex;
  }
  return hex;
}

function makeSalt_() {
  return Utilities.getUuid();
}

function verifyPassword_(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  return timingSafeEqual_(hashPassword_(password, salt), expectedHash);
}

/** Minimal HMAC-signed session token — no external JWT library needed.
 * Payload: base64({uid, exp}); Signature: HMAC-SHA256(payload, TOKEN_SECRET). */
function signToken_(email, isMobile) {
  var secret = PROPS.getProperty('TOKEN_SECRET');
  if (!secret) throw new Error('Server misconfigured: TOKEN_SECRET script property not set.');
  var ttl = isMobile ? TOKEN_TTL_MOBILE_MS : TOKEN_TTL_MS;
  var payload = JSON.stringify({ uid: email, exp: Date.now() + ttl });
  var payloadB64 = Utilities.base64EncodeWebSafe(payload);
  var sigBytes = Utilities.computeHmacSha256Signature(payloadB64, secret);
  var sigHex = bytesToHex_(sigBytes);
  return payloadB64 + '.' + sigHex;
}

function verifyToken_(token) {
  var secret = PROPS.getProperty('TOKEN_SECRET');
  if (!secret || !token) return null;
  var parts = token.split('.');
  if (parts.length !== 2) return null;
  var payloadB64 = parts[0], sigHex = parts[1];
  var expectedSigBytes = Utilities.computeHmacSha256Signature(payloadB64, secret);
  var expectedHex = bytesToHex_(expectedSigBytes);
  if (!timingSafeEqual_(expectedHex, sigHex)) return null;
  try {
    var payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(payloadB64)).getDataAsString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload; // { uid: email, exp }
  } catch (e) {
    return null;
  }
}

/** "Screen: Lubrication Explorer" -> "lubrication_explorer" — matches the
 * screenKey strings the frontend's nav and route guards already use. */
function screenKeyFromHeader_(header) {
  return header.replace(/^Screen:\s*/, '').trim().toLowerCase().replace(/\s+/g, '_');
}

/** "Can: editData" -> "editData" — already camelCase after the prefix. */
function capabilityKeyFromHeader_(header) {
  return header.replace(/^Can:\s*/, '').trim();
}

/**
 * Resolves a Title name into { dataScope, screenAccess, capabilities } by
 * joining Titles -> Permission Templates. Cached per request via a module
 * cache would be nice but Apps Script has no real request-scoped state, so
 * this re-reads the (small, ~12-row) Permission Templates sheet each call —
 * fine at this data volume.
 */
function resolvePermissionTemplate_(titleName) {
  var titles = readRows_(BOOK.CONFIG, SHEETS.TITLES);
  var titleRow = titles.filter(function (t) { return t['Title Name'] === titleName; })[0];
  var templateName = titleRow ? titleRow['Permission Template'] : null;

  var sheet = getSheet_(BOOK.CONFIG, SHEETS.PERMISSION_TEMPLATES);
  var table = readTable_(sheet);
  var row = table.rows.filter(function (r) { return r['Title'] === (templateName || titleName); })[0];

  var screenAccess = {};
  var capabilities = {};
  var dataScope = 'OWN_ORG';

  if (row) {
    dataScope = String(row['Data Scope'] || 'OWN_ORG').toUpperCase();
    table.headers.forEach(function (h) {
      if (!h) return;
      if (h.indexOf('Screen:') === 0) screenAccess[screenKeyFromHeader_(h)] = boolFromYesNo_(row[h]);
      else if (h.indexOf('Can:') === 0) capabilities[capabilityKeyFromHeader_(h)] = boolFromYesNo_(row[h]);
    });
  }

  return { dataScope: dataScope, screenAccess: screenAccess, capabilities: capabilities, templateName: templateName };
}

/** Builds the full AuthUser object the frontend expects, from a Users-tab row + email. */
function buildAuthUser_(userRow) {
  var titles = readRows_(BOOK.CONFIG, SHEETS.TITLES);
  var titleRow = titles.filter(function (t) { return t['Title Name'] === userRow['Title']; })[0];
  var orgName = titleRow ? titleRow['Organization'] : null;
  if (orgName === '(all orgs)') orgName = null;

  var perm = resolvePermissionTemplate_(userRow['Title']);

  return {
    id: userRow['Email'],
    name: userRow['Name'],
    email: userRow['Email'],
    titleId: userRow['Title'] || null,
    titleName: userRow['Title'] || null,
    organizationId: orgName,        // organization NAME is used as the id throughout this script —
    organizationName: orgName,      // there is no separate cuid in the spreadsheet design.
    dataScope: perm.dataScope === 'ALL_ORGS' ? 'ALL_ORGS' : 'OWN_ORG',
    screenAccess: perm.screenAccess,
    capabilities: perm.capabilities,
    languagePref: userRow['Language'] || 'en',
    mustChangePassword: boolFromYesNo_(userRow['Must Change Password']),
    active: boolFromYesNo_(userRow['Active'])
  };
}

function findUserRowByEmail_(email) {
  var rows = readRows_(BOOK.CONFIG, SHEETS.USERS);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['Email']).toLowerCase() === String(email).toLowerCase()) return rows[i];
  }
  return null;
}

/** Verifies the token and returns a fresh AuthUser — re-read from the sheet
 * every call (not decoded from the token) so a permission-template edit by
 * Super Admin takes effect on the user's very next request. */
function requireAuth_(token) {
  var payload = verifyToken_(token);
  if (!payload) throw apiError_(401, 'Missing or invalid session token.');
  var userRow = findUserRowByEmail_(payload.uid);
  if (!userRow || !boolFromYesNo_(userRow['Active'])) throw apiError_(401, 'Account not found or deactivated.');
  return buildAuthUser_(userRow);
}

function requireScreen_(user, screenKey) {
  if (!user.screenAccess[screenKey]) throw apiError_(403, 'No access to screen: ' + screenKey);
}

function requireCapability_(user, capabilityKey) {
  if (!user.capabilities[capabilityKey]) throw apiError_(403, 'Missing capability: ' + capabilityKey);
}

/** OWN_ORG-scoped callers are restricted to their own org; ALL_ORGS callers see everything. */
function orgScopeOrNull_(user, requestedContractor) {
  if (user.dataScope === 'ALL_ORGS') return requestedContractor || null;
  return user.organizationId || '__none__';
}

// ─────────────────────────────────────────────────────────────────────────
// DUE-DATE / STATUS-BUCKET / COMPLIANCE LOGIC
// Ported 1:1 from the Node backend's framework-free backend/src/lib/dueDate.ts
// so the numbers match exactly (reference: 657 calendar points, 560 overdue,
// 14.8% compliance against the real 902-point register at handover).
// ─────────────────────────────────────────────────────────────────────────

function daysBetween_(from, to) {
  var f = new Date(from); f.setHours(0, 0, 0, 0);
  var t = new Date(to); t.setHours(0, 0, 0, 0);
  return Math.round((t.getTime() - f.getTime()) / 86400000);
}

function bucketFromDaysToDue_(daysToDue) {
  if (daysToDue < 0) return 'OVERDUE';
  if (daysToDue === 0) return 'DUE_TODAY';
  if (daysToDue <= 7) return 'DUE_THIS_WEEK';
  if (daysToDue <= 30) return 'DUE_THIS_MONTH';
  return 'OK';
}

/**
 * lp: { frequencyType, frequencyIntervalDays, lastChangeDateCache, oaRequired, oaIntervalDays, oaLastSampleDate }
 * frequencyType is matched case-insensitively against 'calendar' | 'oil_analysis' | 'as_needed'
 * (the literal lowercase values used in the Lubrication Points sheet).
 */
function computeLubricationStatus_(lp, today) {
  today = today || new Date();
  var ft = String(lp.frequencyType || '').toLowerCase();
  if (ft === 'as_needed' || ft === 'oil_analysis') {
    return { nextDue: null, daysToDue: null, bucket: 'CONDITION_MONITORING' };
  }
  // calendar
  if (!lp.lastChangeDateCache || !lp.frequencyIntervalDays) {
    return { nextDue: null, daysToDue: null, bucket: 'NO_HISTORY' };
  }
  var lastChange = new Date(lp.lastChangeDateCache);
  var nextDue = new Date(lastChange);
  nextDue.setDate(nextDue.getDate() + Number(lp.frequencyIntervalDays));
  var daysToDue = daysBetween_(today, nextDue);
  return { nextDue: nextDue, daysToDue: daysToDue, bucket: bucketFromDaysToDue_(daysToDue) };
}

function computeOilAnalysisStatus_(lp, today) {
  today = today || new Date();
  if (!lp.oaRequired) return { nextDue: null, daysToDue: null, bucket: 'CONDITION_MONITORING' };
  if (!lp.oaLastSampleDate || !lp.oaIntervalDays) return { nextDue: null, daysToDue: null, bucket: 'NO_HISTORY' };
  var lastSample = new Date(lp.oaLastSampleDate);
  var nextDue = new Date(lastSample);
  nextDue.setDate(nextDue.getDate() + Number(lp.oaIntervalDays));
  var daysToDue = daysBetween_(today, nextDue);
  return { nextDue: nextDue, daysToDue: daysToDue, bucket: bucketFromDaysToDue_(daysToDue) };
}

function computeComplianceStats_(points, today) {
  today = today || new Date();
  var calendarPoints = points.filter(function (p) { return String(p.frequencyType).toLowerCase() === 'calendar'; });
  var stats = { totalCalendarPoints: calendarPoints.length, overdue: 0, dueToday: 0, dueThisWeek: 0, dueThisMonth: 0, ok: 0, noHistory: 0, compliancePct: 0 };
  calendarPoints.forEach(function (p) {
    var bucket = computeLubricationStatus_(p, today).bucket;
    if (bucket === 'OVERDUE') stats.overdue++;
    else if (bucket === 'DUE_TODAY') stats.dueToday++;
    else if (bucket === 'DUE_THIS_WEEK') stats.dueThisWeek++;
    else if (bucket === 'DUE_THIS_MONTH') stats.dueThisMonth++;
    else if (bucket === 'OK') stats.ok++;
    else if (bucket === 'NO_HISTORY') stats.noHistory++;
  });
  stats.compliancePct = stats.totalCalendarPoints
    ? Math.round(((stats.totalCalendarPoints - stats.overdue) / stats.totalCalendarPoints) * 1000) / 10
    : 0;
  return stats;
}

function computeOilAnalysisStats_(points, today) {
  today = today || new Date();
  var oaPoints = points.filter(function (p) { return p.oaRequired; });
  var stats = { totalOaPoints: oaPoints.length, overdue: 0, dueThisMonth: 0, ok: 0, noHistory: 0 };
  oaPoints.forEach(function (p) {
    var bucket = computeOilAnalysisStatus_(p, today).bucket;
    if (bucket === 'OVERDUE') stats.overdue++;
    else if (bucket === 'DUE_THIS_WEEK' || bucket === 'DUE_THIS_MONTH') stats.dueThisMonth++;
    else if (bucket === 'OK') stats.ok++;
    else if (bucket === 'NO_HISTORY') stats.noHistory++;
  });
  return stats;
}

// ─────────────────────────────────────────────────────────────────────────
// DOMAIN INDEXES — join Lubrication Points (Operational) with Equipment /
// Areas / Organizations (Config), and compute each point's cached
// "last approved change date" from Lubrication History (since the sheet,
// unlike the old Prisma model, has no lastChangeDateCache column — it's
// derived fresh from the latest APPROVED history row each request).
// ─────────────────────────────────────────────────────────────────────────

function getAreaOrgMap_() {
  var areas = readRows_(BOOK.CONFIG, SHEETS.AREAS);
  var map = {};
  areas.forEach(function (a) { map[a['Area Name']] = a['Contractor']; });
  return map;
}

function getEquipmentMap_() {
  var equipment = readRows_(BOOK.CONFIG, SHEETS.EQUIPMENT);
  var map = {};
  equipment.forEach(function (e) { map[e['Equipment Code']] = e; });
  return map;
}

/** lpIdCode -> latest Date among APPROVED Lubrication History rows for that point. */
function getLastApprovedDateMap_() {
  var rows = readRows_(BOOK.OPERATIONAL, SHEETS.LUBRICATION_HISTORY);
  var map = {};
  rows.forEach(function (r) {
    if (r['Status'] !== 'APPROVED') return;
    var lpId = r['LP ID'];
    var d = toDateOrNull_(r['Lubrication Date']);
    if (!d) return;
    if (!map[lpId] || d > map[lpId]) map[lpId] = d;
  });
  return map;
}

/**
 * Returns every Lubrication Point joined with Equipment/Area/Organization
 * context and its computed lastChangeDateCache, ready for status math.
 * This is the single most-used index in the app — built once per request.
 */
function getLpIndex_() {
  var lpRows = readRows_(BOOK.OPERATIONAL, SHEETS.LUBRICATION_POINTS);
  var equipmentMap = getEquipmentMap_();
  var lastApproved = getLastApprovedDateMap_();

  return lpRows.map(function (r) {
    var equipmentCode = r['Equipment Code'];
    var equipment = equipmentMap[equipmentCode] || {};
    return {
      lpIdCode: r['LP ID'],
      equipmentIdCode: equipmentCode,
      assetName: r['Equipment Name'] || equipment['Asset Name'] || null,
      areaName: r['Area'] || equipment['Area'] || null,
      contractor: r['Contractor'] || equipment['Contractor'] || null,
      pointDescription: r['Point Description'],
      pointCode: r['Point Code'] || null,
      position: r['Position'] || null,
      lubricantType: r['Lubricant Type'] || null,
      standardQuantityL: r['Standard Qty (L)'] === '' ? null : r['Standard Qty (L)'],
      frequencyType: r['Frequency Type'],
      frequencyLabel: r['Frequency Label'] || null,
      frequencyIntervalDays: r['Frequency Interval (days)'] === '' ? null : r['Frequency Interval (days)'],
      ohHoursReference: r['OH Hours Reference'] === '' ? null : r['OH Hours Reference'],
      oaRequired: boolFromYesNo_(r['Oil Analysis Required']),
      oaIntervalDays: r['OA Interval (days)'] === '' ? null : r['OA Interval (days)'],
      oaIntervalLabel: r['OA Interval Label'] || null,
      oaLastSampleDate: toDateOrNull_(r['Last Oil Sample Date']),
      remarks: r['Remarks'] || null,
      gearboxBrand: equipment['Gearbox Brand'] || null,
      opTempC: equipment['Operating Temp (°C)'] === undefined || equipment['Operating Temp (°C)'] === '' ? null : equipment['Operating Temp (°C)'],
      annualRhActual: equipment['Annual RH Actual'] === undefined || equipment['Annual RH Actual'] === '' ? null : equipment['Annual RH Actual'],
      lastChangeDateCache: lastApproved[r['LP ID']] || null,
      __row: r.__row
    };
  });
}

function lpStatusInput_(lp) {
  return {
    frequencyType: lp.frequencyType,
    frequencyIntervalDays: lp.frequencyIntervalDays,
    lastChangeDateCache: lp.lastChangeDateCache,
    oaRequired: lp.oaRequired,
    oaIntervalDays: lp.oaIntervalDays,
    oaLastSampleDate: lp.oaLastSampleDate
  };
}

/** Org-scope filter applied uniformly across LP-derived endpoints. */
function filterLpByOrg_(points, organizationId) {
  if (!organizationId) return points;
  return points.filter(function (p) { return p.contractor === organizationId; });
}

// ─────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS & AUDIT LOG
// ─────────────────────────────────────────────────────────────────────────

/** Resolves routing tokens (OWN_ORG_ENGINEER, ACC_MANAGER, SUPER_ADMIN, ...)
 * into concrete user emails. Ported from backend/src/lib/notify.ts. */
function resolveRecipients_(tokens, organizationId, extraEmails) {
  var emails = {};
  (extraEmails || []).forEach(function (e) { emails[e] = true; });

  var users = readRows_(BOOK.CONFIG, SHEETS.USERS);
  var titles = readRows_(BOOK.CONFIG, SHEETS.TITLES);
  var titleOrgByName = {};
  titles.forEach(function (t) { titleOrgByName[t['Title Name']] = t['Organization']; });

  var fragmentByToken = { OWN_ORG_TECHNICIAN: 'Technician', OWN_ORG_ENGINEER: 'Engineer', OWN_ORG_MANAGER: 'Manager' };

  tokens.forEach(function (token) {
    token = token.trim();
    if (token === 'UPLOADER' || token === 'SELF') return; // handled via extraEmails by the caller
    if (token === 'SUPER_ADMIN') {
      users.filter(function (u) { return u['Title'] === 'Super Admin'; }).forEach(function (u) { emails[u['Email']] = true; });
      return;
    }
    if (token === 'ACC_ENGINEER' || token === 'ACC_MANAGER') {
      var titleName = token === 'ACC_ENGINEER' ? 'ACC Engineer' : 'ACC Manager';
      users.filter(function (u) { return u['Title'] === titleName; }).forEach(function (u) { emails[u['Email']] = true; });
      return;
    }
    var fragment = fragmentByToken[token];
    if (fragment && organizationId) {
      users.forEach(function (u) {
        var org = titleOrgByName[u['Title']];
        if (org === organizationId && String(u['Title'] || '').indexOf(fragment) !== -1) emails[u['Email']] = true;
      });
    }
  });
  return Object.keys(emails);
}

/**
 * Creates Notifications rows for whoever the routing rules for `typeName`
 * say should be notified. organizationId is the event's org context (null
 * for global events). Silently no-ops on an unknown type, same as before.
 */
function notify_(opts) {
  var types = readRows_(BOOK.CONFIG, SHEETS.NOTIFICATION_TYPES);
  var type = types.filter(function (t) { return t['Name'] === opts.typeName; })[0];
  if (!type) return;
  var tokens = String(type['Recipients'] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var recipients = resolveRecipients_(tokens, opts.organizationId || null, opts.extraEmails || []);
  if (recipients.length === 0) return;

  recipients.forEach(function (email) {
    withScriptLock_(function () {
      var id = nextSequentialId_(BOOK.OPERATIONAL, SHEETS.NOTIFICATIONS, 'Notification ID', 'NTF-', 5);
      appendRowObj_(BOOK.OPERATIONAL, SHEETS.NOTIFICATIONS, {
        'Notification ID': id,
        'User Email': email,
        'Type': opts.typeName,
        'Message': opts.message,
        'Related Entity Type': opts.relatedEntityType || '',
        'Related Entity ID': opts.relatedEntityId || '',
        'Priority': type['Default Priority'] || 'INFO',
        'Status': 'UNREAD',
        'Created At': new Date()
      });
    });
  });
}

/** Appends an Audit Log row. Every ACC data correction / admin-settings
 * change lands here with a mandatory reason (Section 9 of the spec). */
function writeAuditLog_(opts) {
  withScriptLock_(function () {
    var id = nextSequentialId_(BOOK.OPERATIONAL, SHEETS.AUDIT_LOG, 'Log ID', 'AUD-', 5);
    appendRowObj_(BOOK.OPERATIONAL, SHEETS.AUDIT_LOG, {
      'Log ID': id,
      'Actor Email': opts.actorEmail,
      'Action Category': opts.actionCategory,
      'Entity Type': opts.entityType,
      'Entity ID': opts.entityId,
      'Before Value': opts.beforeValue ? JSON.stringify(opts.beforeValue) : '',
      'After Value': opts.afterValue ? JSON.stringify(opts.afterValue) : '',
      'Reason': opts.reason || '',
      'Timestamp': new Date(),
      'Visible To Org': opts.visibleToOrg || ''
    });
  });
}

function getSettingValue_(key, fallback) {
  var rows = readRows_(BOOK.CONFIG, SHEETS.GENERAL_SETTINGS);
  var row = rows.filter(function (r) { return r['Key'] === key; })[0];
  return row && row['Value'] !== '' && row['Value'] !== null ? String(row['Value']) : fallback;
}

// ─────────────────────────────────────────────────────────────────────────
// API: AUTH
// ─────────────────────────────────────────────────────────────────────────

function api_loginUser_(params) {
  var email = String(params.email || '').trim();
  var password = String(params.password || '');
  if (!email || !password) throw apiError_(400, 'Email and password are required.');

  var userRow = findUserRowByEmail_(email);
  if (!userRow || !boolFromYesNo_(userRow['Active'])) throw apiError_(401, 'Invalid email or password.');

  var hash = userRow['Password Hash'];
  var salt = userRow['Password Salt'];
  if (!hash || !salt) {
    throw apiError_(401, 'This account has no password set yet. Ask a Super Admin to set an initial password (see DEPLOYMENT_GUIDE.md).');
  }
  if (!verifyPassword_(password, salt, hash)) throw apiError_(401, 'Invalid email or password.');

  var token = signToken_(email, !!params.isMobile);
  var authUser = buildAuthUser_(userRow);
  return {
    token: token,
    mustChangePassword: authUser.mustChangePassword,
    user: {
      id: authUser.id,
      name: authUser.name,
      email: authUser.email,
      title: authUser.titleName,
      organization: authUser.organizationName,
      languagePref: authUser.languagePref,
      themePref: 'default'
    }
  };
}

function api_changePassword_(params, user) {
  var current = String(params.currentPassword || '');
  var next = String(params.newPassword || '');
  if (next.length < 8) throw apiError_(400, 'Password must be at least 8 characters.');

  var userRow = findUserRowByEmail_(user.email);
  if (!userRow) throw apiError_(404, 'User not found.');
  if (userRow['Password Hash'] && !verifyPassword_(current, userRow['Password Salt'], userRow['Password Hash'])) {
    throw apiError_(401, 'Current password is incorrect.');
  }
  var salt = makeSalt_();
  var hash = hashPassword_(next, salt);
  updateRowByKey_(BOOK.CONFIG, SHEETS.USERS, 'Email', user.email, {
    'Password Hash': hash, 'Password Salt': salt, 'Must Change Password': 'No'
  });
  return { success: true };
}

function api_getMe_(params, user) {
  return { user: user };
}

// ─────────────────────────────────────────────────────────────────────────
// API: DASHBOARD
// ─────────────────────────────────────────────────────────────────────────

function resolveOrgFilter_(user, scopeOrContractorParam) {
  if (user.dataScope !== 'ALL_ORGS') return user.organizationId || '__none__';
  if (!scopeOrContractorParam) return null;
  var s = String(scopeOrContractorParam).toLowerCase();
  if (s === 'all') return null;
  var orgs = readRows_(BOOK.CONFIG, SHEETS.ORGANIZATIONS);
  var match = orgs.filter(function (o) { return String(o['Name']).toLowerCase() === s; })[0];
  return match ? match['Name'] : scopeOrContractorParam;
}

function api_getDashboardData_(params, user) {
  var metric = params.metric || 'kpis';

  if (metric === 'overdueBreakdown') {
    var organizationId = resolveOrgFilter_(user, null); // breakdown always within the caller's own scope (no cross-contractor mixing)
    var groupBy = params.groupBy || 'contractor';
    var points = filterLpByOrg_(getLpIndex_(), organizationId);
    var buckets = {};
    points.forEach(function (p) {
      var result = computeLubricationStatus_(lpStatusInput_(p));
      if (result.bucket !== 'OVERDUE') return;
      var key;
      if (groupBy === 'area') key = p.areaName || 'Unassigned';
      else if (groupBy === 'frequency') key = p.frequencyLabel || 'Unknown';
      else key = p.contractor || 'Unknown';
      buckets[key] = (buckets[key] || 0) + 1;
    });
    return { groupBy: groupBy, breakdown: Object.keys(buckets).map(function (k) { return { key: k, count: buckets[k] }; }) };
  }

  if (metric === 'contractorComparison') {
    if (user.dataScope !== 'ALL_ORGS') throw apiError_(403, 'Contractor comparison is ACC/Super Admin only.');
    var orgs2 = readRows_(BOOK.CONFIG, SHEETS.ORGANIZATIONS).filter(function (o) { return o['Type'] === 'contractor'; });
    var allPoints = getLpIndex_();
    var history = readRows_(BOOK.OPERATIONAL, SHEETS.LUBRICATION_HISTORY);
    var plans = readRows_(BOOK.OPERATIONAL, SHEETS.ACTION_PLANS);
    var results = orgs2.map(function (org) {
      var pts = filterLpByOrg_(allPoints, org['Name']);
      var compliance = computeComplianceStats_(pts.map(lpStatusInput_));
      var oa = computeOilAnalysisStats_(pts.map(lpStatusInput_));
      var pending = history.filter(function (h) { return h['Status'] === 'PENDING_APPROVAL' && pointBelongsToOrg_(allPoints, h['LP ID'], org['Name']); }).length;
      var openActions = plans.filter(function (p) { return ['OPEN', 'IN_PROGRESS', 'WAITING'].indexOf(p['Status']) !== -1 && actionPlanBelongsToOrg_(allPoints, p, org['Name']); }).length;
      return { organization: org['Name'], totalPoints: pts.length, overdue: compliance.overdue, compliancePct: compliance.compliancePct, oilSamplesOverdue: oa.overdue, pendingApproval: pending, openActionPlans: openActions };
    });
    return { comparison: results };
  }

  // metric === 'kpis' (default)
  var orgId = resolveOrgFilter_(user, params.scope);
  var pts2 = filterLpByOrg_(getLpIndex_(), orgId);
  var compliance2 = computeComplianceStats_(pts2.map(lpStatusInput_));
  var oa2 = computeOilAnalysisStats_(pts2.map(lpStatusInput_));
  var conditionMonitoring = pts2.filter(function (p) { return String(p.frequencyType).toLowerCase() === 'as_needed'; }).length;

  var lpIdsInScope = {};
  pts2.forEach(function (p) { lpIdsInScope[p.lpIdCode] = true; });

  var historyRows = readRows_(BOOK.OPERATIONAL, SHEETS.LUBRICATION_HISTORY);
  var monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  var pendingApproval = 0, completedThisMonth = 0;
  historyRows.forEach(function (h) {
    if (!lpIdsInScope[h['LP ID']]) return;
    if (h['Status'] === 'PENDING_APPROVAL') pendingApproval++;
    if (h['Status'] === 'APPROVED' && h['Legacy Import'] !== 'Yes') {
      var approvedAt = toDateOrNull_(h['Approved At']);
      if (approvedAt && approvedAt >= monthStart) completedThisMonth++;
    }
  });

  var planRows = readRows_(BOOK.OPERATIONAL, SHEETS.ACTION_PLANS);
  var openActions = 0, overdueActions = 0;
  var now = new Date();
  planRows.forEach(function (p) {
    if (orgId && !actionPlanBelongsToOrg_(pts2, p, orgId)) return;
    if (['OPEN', 'IN_PROGRESS', 'WAITING'].indexOf(p['Status']) === -1) return;
    openActions++;
    var due = toDateOrNull_(p['Due Date']);
    if (due && due < now) overdueActions++;
  });

  return {
    totalLubricationPoints: pts2.length,
    overdue: compliance2.overdue,
    dueToday: compliance2.dueToday,
    dueThisWeek: compliance2.dueThisWeek,
    dueThisMonth: compliance2.dueThisMonth,
    ok: compliance2.ok,
    noHistory: compliance2.noHistory,
    compliancePct: compliance2.compliancePct,
    conditionMonitoringPoints: conditionMonitoring,
    oilSamplesOverdue: oa2.overdue,
    oilSamplesDueThisMonth: oa2.dueThisMonth,
    pendingApproval: pendingApproval,
    completedThisMonth: completedThisMonth,
    openActionPlans: openActions,
    overdueActionPlans: overdueActions
  };
}

function pointBelongsToOrg_(allPoints, lpId, org) {
  for (var i = 0; i < allPoints.length; i++) {
    if (allPoints[i].lpIdCode === lpId) return allPoints[i].contractor === org;
  }
  return false;
}

function actionPlanBelongsToOrg_(pointsInScope, planRow, org) {
  // Action Plans reference an Equipment code; resolve via the LP index's equipment->contractor join.
  for (var i = 0; i < pointsInScope.length; i++) {
    if (pointsInScope[i].equipmentIdCode === planRow['Equipment']) return pointsInScope[i].contractor === org;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// API: LUBRICATION POINTS (Explorer + Details + ACC correction)
// ─────────────────────────────────────────────────────────────────────────

function api_getLubricationPoints_(params, user) {
  var orgId = user.dataScope !== 'ALL_ORGS' ? (user.organizationId || '__none__') : (params.contractor || null);
  var points = filterLpByOrg_(getLpIndex_(), orgId);

  if (params.area) points = points.filter(function (p) { return p.areaName === params.area; });
  if (params.equipment) points = points.filter(function (p) { return p.equipmentIdCode === params.equipment; });
  if (params.frequency) points = points.filter(function (p) { return String(p.frequencyType).toLowerCase() === String(params.frequency).toLowerCase(); });
  if (params.lubricant) points = points.filter(function (p) { return p.lubricantType === params.lubricant; });
  if (params.search) {
    var s = String(params.search).toLowerCase();
    points = points.filter(function (p) {
      return (p.lpIdCode || '').toLowerCase().indexOf(s) !== -1 ||
        (p.pointDescription || '').toLowerCase().indexOf(s) !== -1 ||
        (p.equipmentIdCode || '').toLowerCase().indexOf(s) !== -1 ||
        (p.assetName || '').toLowerCase().indexOf(s) !== -1;
    });
  }

  var rows = points.map(function (p) {
    var lubStatus = computeLubricationStatus_(lpStatusInput_(p));
    var oaStatus = p.oaRequired ? computeOilAnalysisStatus_(lpStatusInput_(p)) : null;
    return {
      id: p.lpIdCode,
      lpIdCode: p.lpIdCode,
      equipmentIdCode: p.equipmentIdCode,
      assetName: p.assetName,
      pointDescription: p.pointDescription,
      areaName: p.areaName,
      contractor: p.contractor,
      lubricantType: p.lubricantType,
      standardQuantityL: p.standardQuantityL,
      frequencyLabel: p.frequencyLabel,
      frequencyType: p.frequencyType,
      lastChangeDate: toIso_(p.lastChangeDateCache),
      nextDue: toIso_(lubStatus.nextDue),
      status: lubStatus.bucket,
      oaStatus: oaStatus ? oaStatus.bucket : null
    };
  });

  if (params.status) rows = rows.filter(function (r) { return r.status === params.status; });

  var pageNum = Math.max(1, parseInt(params.page || '1', 10) || 1);
  var size = Math.min(900, Math.max(1, parseInt(params.pageSize || '50', 10) || 50));
  var start = (pageNum - 1) * size;
  var paged = rows.slice(start, start + size);

  return { total: rows.length, page: pageNum, pageSize: size, rows: paged };
}

function api_getLubricationPointById_(params, user) {
  var id = params.id;
  var points = getLpIndex_();
  var p = points.filter(function (x) { return x.lpIdCode === id; })[0];
  if (!p) throw apiError_(404, 'Lubrication point not found.');
  if (user.dataScope !== 'ALL_ORGS' && p.contractor !== user.organizationId) {
    throw apiError_(403, "Not authorized for this organization's data.");
  }

  var history = readRows_(BOOK.OPERATIONAL, SHEETS.LUBRICATION_HISTORY)
    .filter(function (h) { return h['LP ID'] === id; })
    .sort(function (a, b) { return toDateOrNull_(b['Lubrication Date']) - toDateOrNull_(a['Lubrication Date']); });

  var oilSamples = readRows_(BOOK.OPERATIONAL, SHEETS.OIL_SAMPLES)
    .filter(function (s) { return s['LP ID'] === id; })
    .sort(function (a, b) { return toDateOrNull_(b['Sampled Date']) - toDateOrNull_(a['Sampled Date']); });

  var actionPlans = readRows_(BOOK.OPERATIONAL, SHEETS.ACTION_PLANS).filter(function (a) {
    if (a['Equipment'] !== p.equipmentIdCode) return false;
    var lpIds = String(a['LP IDs'] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    return lpIds.length === 0 || lpIds.indexOf(id) !== -1;
  }).sort(function (a, b) { return toDateOrNull_(b['Created At']) - toDateOrNull_(a['Created At']); });

  var lubStatus = computeLubricationStatus_(lpStatusInput_(p));
  var oaStatus = p.oaRequired ? computeOilAnalysisStatus_(lpStatusInput_(p)) : null;

  return {
    id: p.lpIdCode,
    lpIdCode: p.lpIdCode,
    pointDescription: p.pointDescription,
    pointCode: p.pointCode,
    position: p.position,
    equipment: {
      id: p.equipmentIdCode,
      code: p.equipmentIdCode,
      name: p.assetName,
      area: p.areaName,
      contractor: p.contractor,
      gearboxBrand: p.gearboxBrand,
      opTempC: p.opTempC,
      annualRhActual: p.annualRhActual
    },
    lubricantType: p.lubricantType ? { name: p.lubricantType, brand: null } : null,
    standardQuantityL: p.standardQuantityL,
    frequencyLabel: p.frequencyLabel,
    frequencyType: p.frequencyType,
    ohHoursReference: p.ohHoursReference,
    oaRequired: p.oaRequired,
    oaIntervalLabel: p.oaIntervalLabel,
    remarks: p.remarks,
    status: lubStatus.bucket,
    nextDue: toIso_(lubStatus.nextDue),
    oaStatus: oaStatus ? oaStatus.bucket : null,
    history: history.map(function (h) {
      return {
        id: h['Record ID'],
        date: toIso_(h['Lubrication Date']),
        technician: h['Technician'] || (h['Legacy Import'] === 'Yes' ? 'Legacy import' : null),
        quantityUsedL: h['Quantity Used (L)'] === '' ? null : h['Quantity Used (L)'],
        oilType: h['Oil Type Used'] || null,
        status: h['Status'],
        remarks: h['Remarks'] || null,
        isLegacyImport: h['Legacy Import'] === 'Yes',
        approvedBy: h['Approved By'] || null
      };
    }),
    oilSamples: oilSamples.map(function (s) {
      return { id: s['Lab Sample ID'], sampledDate: toIso_(s['Sampled Date']), reportStatus: s['Report Status'], sampleIdLab: s['Lab Sample ID'] };
    }),
    actionPlans: actionPlans.map(function (a) {
      return { id: a['Action ID'], type: a['Action Type'], description: a['Description'], priority: a['Priority'], status: a['Status'], owner: a['Owner'] || null, dueDate: toIso_(a['Due Date']) };
    })
  };
}

function api_updateLubricationPoint_(params, user) {
  if (!user.capabilities.editData) throw apiError_(403, 'Missing capability: editData');
  if (!params.reason) throw apiError_(400, 'A reason is required for ACC corrections.');

  var id = params.id;
  var sheet = getSheet_(BOOK.OPERATIONAL, SHEETS.LUBRICATION_POINTS);
  var table = readTable_(sheet);
  var before = table.rows.filter(function (r) { return r['LP ID'] === id; })[0];
  if (!before) throw apiError_(404, 'Lubrication point not found.');

  var updates = {};
  if (params.standardQuantityL !== undefined) updates['Standard Qty (L)'] = params.standardQuantityL === null ? '' : params.standardQuantityL;
  if (params.lubricantTypeId !== undefined) updates['Lubricant Type'] = params.lubricantTypeId === null ? '' : params.lubricantTypeId;
  if (params.remarks !== undefined) updates['Remarks'] = params.remarks === null ? '' : params.remarks;

  updateRowByKey_(BOOK.OPERATIONAL, SHEETS.LUBRICATION_POINTS, 'LP ID', id, updates);

  var equipmentMap = getEquipmentMap_();
  var org = (equipmentMap[before['Equipment Code']] || {})['Contractor'] || before['Contractor'] || null;

  writeAuditLog_({
    actorEmail: user.email,
    actionCategory: 'DATA_EDIT',
    entityType: 'LubricationPoint',
    entityId: id,
    beforeValue: before,
    afterValue: updates,
    reason: params.reason,
    visibleToOrg: org
  });

  return { success: true, lubricationPoint: api_getLubricationPointById_({ id: id }, user) };
}

// ─────────────────────────────────────────────────────────────────────────
// API: LUBRICATION RECORDS (submit / pending approvals / approve / reject)
// All rows live in the single "Lubrication History" tab, status-filtered —
// there is no separate "Pending Approvals" tab, matching the existing
// workbook's design (status column already distinguishes the two).
// ─────────────────────────────────────────────────────────────────────────

function api_submitLubrication_(params, user) {
  if (!user.capabilities.submit) throw apiError_(403, 'Missing capability: submit');
  if (!params.lpId) throw apiError_(400, 'lpId is required.');
  if (!params.lubricationDate) throw apiError_(400, 'lubricationDate is required.');

  var lubricationDate = new Date(params.lubricationDate);
  var todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  if (lubricationDate > todayEnd) throw apiError_(400, 'Lubrication date cannot be in the future.');

  var points = getLpIndex_();
  var lp = points.filter(function (p) { return p.lpIdCode === params.lpId; })[0];
  if (!lp) throw apiError_(404, 'Lubrication point not found.');
  if (user.dataScope !== 'ALL_ORGS' && lp.contractor !== user.organizationId) {
    throw apiError_(403, "Not authorized for this organization's data.");
  }

  var quantityUsedL = params.quantityUsedL === undefined || params.quantityUsedL === null ? '' : Number(params.quantityUsedL);
  var oilTypeUsed = params.oilTypeUsedId || lp.lubricantType || '';

  var id;
  withScriptLock_(function () {
    id = nextSequentialId_(BOOK.OPERATIONAL, SHEETS.LUBRICATION_HISTORY, 'Record ID', 'REC-', 5);
    appendRowObj_(BOOK.OPERATIONAL, SHEETS.LUBRICATION_HISTORY, {
      'Record ID': id,
      'LP ID': lp.lpIdCode,
      'Equipment': lp.assetName,
      'Lubrication Date': lubricationDate,
      'Technician': user.name,
      'Quantity Used (L)': quantityUsedL,
      'Oil Type Used': oilTypeUsed,
      'Running Hours': params.runningHours === undefined || params.runningHours === null ? '' : Number(params.runningHours),
      'Remarks': params.remarks || '',
      'Status': 'PENDING_APPROVAL',
      'Submitted At': new Date(),
      'Approved By': '',
      'Approved At': '',
      'Rejected Reason': '',
      'Rejected At': '',
      'Legacy Import': 'No'
    });
  });

  notify_({
    typeName: 'Pending Approval',
    organizationId: lp.contractor,
    message: user.name + ' submitted a lubrication record for ' + lp.lpIdCode + ' — awaiting approval.',
    relatedEntityType: 'LubricationRecord',
    relatedEntityId: id
  });

  if (quantityUsedL !== '' && lp.standardQuantityL) {
    var thresholdPct = parseFloat(getSettingValue_('deviation.quantity_threshold_pct', '20'));
    var deviationPct = Math.abs((quantityUsedL - lp.standardQuantityL) / lp.standardQuantityL) * 100;
    if (deviationPct > thresholdPct) {
      notify_({
        typeName: 'Quantity Deviation', organizationId: lp.contractor,
        message: lp.lpIdCode + ': submitted quantity ' + quantityUsedL + 'L deviates ' + deviationPct.toFixed(0) + '% from standard ' + lp.standardQuantityL + 'L.',
        relatedEntityType: 'LubricationRecord', relatedEntityId: id
      });
    }
  }
  if (params.oilTypeUsedId && lp.lubricantType && params.oilTypeUsedId !== lp.lubricantType) {
    notify_({
      typeName: 'Oil Type Changed', organizationId: lp.contractor,
      message: lp.lpIdCode + ': oil type used differs from the standard lubricant type on file.',
      relatedEntityType: 'LubricationRecord', relatedEntityId: id
    });
  }

  return { record: { id: id, lpId: lp.lpIdCode, status: 'PENDING_APPROVAL' } };
}

function api_getPendingApprovals_(params, user) {
  var points = getLpIndex_();
  var pointByLpId = {};
  points.forEach(function (p) { pointByLpId[p.lpIdCode] = p; });

  var orgId = user.dataScope !== 'ALL_ORGS' ? user.organizationId : null;

  var rows = readRows_(BOOK.OPERATIONAL, SHEETS.LUBRICATION_HISTORY)
    .filter(function (h) { return h['Status'] === 'PENDING_APPROVAL'; })
    .filter(function (h) {
      if (!orgId) return true;
      var lp = pointByLpId[h['LP ID']];
      return lp && lp.contractor === orgId;
    })
    .sort(function (a, b) { return toDateOrNull_(a['Submitted At']) - toDateOrNull_(b['Submitted At']); });

  return {
    records: rows.map(function (h) {
      var lp = pointByLpId[h['LP ID']] || {};
      return {
        id: h['Record ID'],
        lpIdCode: h['LP ID'],
        equipment: lp.assetName || h['Equipment'],
        contractor: lp.contractor || null,
        technician: h['Technician'] || null,
        lubricationDate: toIso_(h['Lubrication Date']),
        quantityUsedL: h['Quantity Used (L)'] === '' ? null : h['Quantity Used (L)'],
        oilType: h['Oil Type Used'] || null,
        remarks: h['Remarks'] || null,
        submittedAt: toIso_(h['Submitted At'])
      };
    })
  };
}

function api_approveLubrication_(params, user) {
  if (!user.capabilities.approve) throw apiError_(403, 'Missing capability: approve');
  var id = params.id;
  var rows = readRows_(BOOK.OPERATIONAL, SHEETS.LUBRICATION_HISTORY);
  var record = rows.filter(function (r) { return r['Record ID'] === id; })[0];
  if (!record) throw apiError_(404, 'Record not found.');
  if (record['Status'] !== 'PENDING_APPROVAL') throw apiError_(400, 'Record is not pending approval.');

  var points = getLpIndex_();
  var lp = points.filter(function (p) { return p.lpIdCode === record['LP ID']; })[0];
  var orgId = lp ? lp.contractor : null;
  if (user.dataScope !== 'ALL_ORGS' && orgId !== user.organizationId) {
    throw apiError_(403, "Not authorized for this organization's data.");
  }

  updateRowByKey_(BOOK.OPERATIONAL, SHEETS.LUBRICATION_HISTORY, 'Record ID', id, {
    'Status': 'APPROVED', 'Approved By': user.name, 'Approved At': new Date()
  });
  // No separate lastChangeDateCache to update — getLpIndex_() derives it
  // fresh from APPROVED history rows on every read.
  return { success: true };
}

function api_rejectLubrication_(params, user) {
  if (!user.capabilities.reject) throw apiError_(403, 'Missing capability: reject');
  if (!params.reason) throw apiError_(400, 'A rejection reason is required.');
  var id = params.id;
  var rows = readRows_(BOOK.OPERATIONAL, SHEETS.LUBRICATION_HISTORY);
  var record = rows.filter(function (r) { return r['Record ID'] === id; })[0];
  if (!record) throw apiError_(404, 'Record not found.');
  if (record['Status'] !== 'PENDING_APPROVAL') throw apiError_(400, 'Record is not pending approval.');

  var points = getLpIndex_();
  var lp = points.filter(function (p) { return p.lpIdCode === record['LP ID']; })[0];
  var orgId = lp ? lp.contractor : null;
  if (user.dataScope !== 'ALL_ORGS' && orgId !== user.organizationId) {
    throw apiError_(403, "Not authorized for this organization's data.");
  }

  updateRowByKey_(BOOK.OPERATIONAL, SHEETS.LUBRICATION_HISTORY, 'Record ID', id, {
    'Status': 'REJECTED', 'Rejected Reason': params.reason, 'Rejected At': new Date(), 'Approved By': user.name
  });

  var technicianName = record['Technician'];
  if (technicianName) {
    var techUser = readRows_(BOOK.CONFIG, SHEETS.USERS).filter(function (u) { return u['Name'] === technicianName; })[0];
    notify_({
      typeName: 'Rejected Record', organizationId: orgId,
      message: 'Your submission for ' + record['LP ID'] + ' was rejected: ' + params.reason,
      relatedEntityType: 'LubricationRecord', relatedEntityId: id,
      extraEmails: techUser ? [techUser['Email']] : []
    });

    var threshold = parseInt(getSettingValue_('repeated_rejection.threshold', '3'), 10);
    var rejectionCount = readRows_(BOOK.OPERATIONAL, SHEETS.LUBRICATION_HISTORY)
      .filter(function (r) { return r['Technician'] === technicianName && r['Status'] === 'REJECTED'; }).length;
    if (rejectionCount >= threshold) {
      var actionType = readRows_(BOOK.CONFIG, SHEETS.ACTION_TYPES).filter(function (a) { return a['Name'] === 'Repeated Rejection'; })[0];
      var engineer = orgId ? readRows_(BOOK.CONFIG, SHEETS.USERS).filter(function (u) {
        var titleRow = readRows_(BOOK.CONFIG, SHEETS.TITLES).filter(function (t) { return t['Title Name'] === u['Title']; })[0];
        return titleRow && titleRow['Organization'] === orgId && String(u['Title']).indexOf('Engineer') !== -1;
      })[0] : null;
      if (actionType && lp) {
        withScriptLock_(function () {
          var actId = nextSequentialId_(BOOK.OPERATIONAL, SHEETS.ACTION_PLANS, 'Action ID', 'ACT-', 5);
          appendRowObj_(BOOK.OPERATIONAL, SHEETS.ACTION_PLANS, {
            'Action ID': actId, 'Action Type': 'Repeated Rejection', 'Auto/Manual': 'auto',
            'Equipment': lp.equipmentIdCode, 'LP IDs': lp.lpIdCode,
            'Description': rejectionCount + ' rejected submissions for this technician — review training/process.',
            'Priority': actionType['Default Priority'], 'Owner': engineer ? engineer['Name'] : '',
            'Due Date': '', 'Status': 'OPEN', 'Created By': user.name, 'Created At': new Date(),
            'Closed Date': '', 'Closure Comments': ''
          });
        });
      }
    }
  }

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────
// API: ACTION PLANS
// ─────────────────────────────────────────────────────────────────────────

function api_getActionPlans_(params, user) {
  var points = getLpIndex_();
  var orgId = user.dataScope !== 'ALL_ORGS' ? user.organizationId : (params.contractor || null);

  var rows = readRows_(BOOK.OPERATIONAL, SHEETS.ACTION_PLANS);
  if (params.status) rows = rows.filter(function (r) { return r['Status'] === params.status; });
  if (orgId) rows = rows.filter(function (r) { return actionPlanBelongsToOrg_(points, r, orgId); });

  var actionTypes = readRows_(BOOK.CONFIG, SHEETS.ACTION_TYPES);
  var typeByName = {};
  actionTypes.forEach(function (t) { typeByName[t['Name']] = t; });
  var equipmentMap = getEquipmentMap_();

  rows.sort(function (a, b) { return toDateOrNull_(b['Created At']) - toDateOrNull_(a['Created At']); });

  return {
    actionPlans: rows.map(function (p) {
      var equip = equipmentMap[p['Equipment']] || {};
      var actionType = typeByName[p['Action Type']] || {};
      return {
        id: p['Action ID'],
        actionType: p['Action Type'],
        autoOrManual: p['Auto/Manual'] || actionType['Auto or Manual'],
        equipment: equip['Asset Name'] || p['Equipment'],
        equipmentCode: p['Equipment'],
        contractor: equip['Contractor'] || null,
        description: p['Description'],
        priority: p['Priority'],
        owner: p['Owner'] || null,
        dueDate: toIso_(p['Due Date']),
        status: p['Status'],
        createdBy: p['Created By'] || null,
        createdAt: toIso_(p['Created At']),
        closedDate: toIso_(p['Closed Date']),
        closureComments: p['Closure Comments'] || null
      };
    })
  };
}

function api_createActionPlan_(params, user) {
  if (!params.actionTypeName) throw apiError_(400, 'actionTypeName is required.');
  if (!params.equipmentId) throw apiError_(400, 'equipmentId is required.');
  if (!params.description) throw apiError_(400, 'description is required.');

  var actionType = readRows_(BOOK.CONFIG, SHEETS.ACTION_TYPES).filter(function (a) { return a['Name'] === params.actionTypeName; })[0];
  if (!actionType) throw apiError_(400, 'Unknown action type.');

  var id;
  withScriptLock_(function () {
    id = nextSequentialId_(BOOK.OPERATIONAL, SHEETS.ACTION_PLANS, 'Action ID', 'ACT-', 5);
    appendRowObj_(BOOK.OPERATIONAL, SHEETS.ACTION_PLANS, {
      'Action ID': id,
      'Action Type': params.actionTypeName,
      'Auto/Manual': actionType['Auto or Manual'],
      'Equipment': params.equipmentId,
      'LP IDs': (params.lpIds || []).join(', '),
      'Description': params.description,
      'Priority': params.priority || actionType['Default Priority'] || 'MEDIUM',
      'Owner': params.ownerName || '',
      'Due Date': params.dueDate ? new Date(params.dueDate) : '',
      'Status': 'OPEN',
      'Created By': user.name,
      'Created At': new Date(),
      'Closed Date': '',
      'Closure Comments': ''
    });
  });
  return { actionPlan: { id: id, status: 'OPEN' } };
}

function api_closeActionPlan_(params, user) {
  if (!user.capabilities.closeActions) throw apiError_(403, 'Missing capability: closeActions');
  if (!params.closureComments) throw apiError_(400, 'Closure comments are required.');

  var plan = readRows_(BOOK.OPERATIONAL, SHEETS.ACTION_PLANS).filter(function (p) { return p['Action ID'] === params.id; })[0];
  if (!plan) throw apiError_(404, 'Action plan not found.');

  if (user.dataScope !== 'ALL_ORGS') {
    var equip = getEquipmentMap_()[plan['Equipment']];
    if (!equip || equip['Contractor'] !== user.organizationId) throw apiError_(403, "Not authorized for this organization's data.");
  }

  updateRowByKey_(BOOK.OPERATIONAL, SHEETS.ACTION_PLANS, 'Action ID', params.id, {
    'Status': 'COMPLETED', 'Closed Date': new Date(), 'Closure Comments': params.closureComments
  });
  return { success: true };
}

function api_updateActionPlanStatus_(params, user) {
  var allowed = ['OPEN', 'IN_PROGRESS', 'WAITING', 'CANCELLED'];
  if (allowed.indexOf(params.status) === -1) throw apiError_(400, 'Invalid status.');
  var plan = readRows_(BOOK.OPERATIONAL, SHEETS.ACTION_PLANS).filter(function (p) { return p['Action ID'] === params.id; })[0];
  if (!plan) throw apiError_(404, 'Action plan not found.');
  if (user.dataScope !== 'ALL_ORGS') {
    var equip = getEquipmentMap_()[plan['Equipment']];
    if (!equip || equip['Contractor'] !== user.organizationId) throw apiError_(403, "Not authorized for this organization's data.");
  }
  updateRowByKey_(BOOK.OPERATIONAL, SHEETS.ACTION_PLANS, 'Action ID', params.id, { 'Status': params.status });
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────
// API: NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────

function api_getNotifications_(params, user) {
  var rows = readRows_(BOOK.OPERATIONAL, SHEETS.NOTIFICATIONS).filter(function (n) { return n['User Email'] === user.email; });
  if (params.status) rows = rows.filter(function (n) { return n['Status'] === params.status; });
  if (params.priority) rows = rows.filter(function (n) { return n['Priority'] === params.priority; });
  rows.sort(function (a, b) { return toDateOrNull_(b['Created At']) - toDateOrNull_(a['Created At']); });

  var unreadCount = readRows_(BOOK.OPERATIONAL, SHEETS.NOTIFICATIONS)
    .filter(function (n) { return n['User Email'] === user.email && n['Status'] === 'UNREAD'; }).length;

  return {
    unreadCount: unreadCount,
    notifications: rows.slice(0, 200).map(function (n) {
      return {
        id: n['Notification ID'], type: n['Type'], message: n['Message'], priority: n['Priority'], status: n['Status'],
        relatedEntityType: n['Related Entity Type'] || null, relatedEntityId: n['Related Entity ID'] || null,
        createdAt: toIso_(n['Created At'])
      };
    })
  };
}

function api_markNotificationRead_(params, user) {
  var n = readRows_(BOOK.OPERATIONAL, SHEETS.NOTIFICATIONS).filter(function (x) { return x['Notification ID'] === params.id; })[0];
  if (!n || n['User Email'] !== user.email) throw apiError_(404, 'Notification not found.');
  updateRowByKey_(BOOK.OPERATIONAL, SHEETS.NOTIFICATIONS, 'Notification ID', params.id, { 'Status': 'READ' });
  return { success: true };
}

function api_archiveNotification_(params, user) {
  var n = readRows_(BOOK.OPERATIONAL, SHEETS.NOTIFICATIONS).filter(function (x) { return x['Notification ID'] === params.id; })[0];
  if (!n || n['User Email'] !== user.email) throw apiError_(404, 'Notification not found.');
  updateRowByKey_(BOOK.OPERATIONAL, SHEETS.NOTIFICATIONS, 'Notification ID', params.id, { 'Status': 'ARCHIVED' });
  return { success: true };
}

function api_markAllNotificationsRead_(params, user) {
  var sheet = getSheet_(BOOK.OPERATIONAL, SHEETS.NOTIFICATIONS);
  var table = readTable_(sheet);
  table.rows.forEach(function (n) {
    if (n['User Email'] === user.email && n['Status'] === 'UNREAD') {
      var colIdx = table.headers.indexOf('Status');
      sheet.getRange(n.__row, colIdx + 1).setValue('READ');
    }
  });
  SpreadsheetApp.flush();
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────
// API: TIMELINE — multi-source event feed (Section 12.6).
// Sources: Lubrication History (submitted/approved/rejected), Action Plans
// (overdue-flagged/oil-sample-overdue-flagged/created/closed), Oil Samples
// (completed), Audit Log (ACC data edits). Merged, sorted desc, capped 300.
// ─────────────────────────────────────────────────────────────────────────

function api_getTimeline_(params, user) {
  var fromDate = params.from ? new Date(params.from) : new Date(Date.now() - 30 * 86400000);
  var toDate = params.to ? new Date(params.to + 'T23:59:59') : new Date();
  var orgId = user.dataScope === 'ALL_ORGS' ? (params.contractor || null) : (user.organizationId || '__none__');
  var wantsType = function (t) { return !params.eventType || params.eventType === t; };
  var inRange = function (d) { return d && d >= fromDate && d <= toDate; };

  var points = getLpIndex_();
  var pointByLpId = {}; points.forEach(function (p) { pointByLpId[p.lpIdCode] = p; });
  var equipmentMap = getEquipmentMap_();

  function equipmentInScope(equipmentCode) {
    var equip = equipmentMap[equipmentCode];
    if (!equip) return !orgId;
    if (orgId && equip['Contractor'] !== orgId) return false;
    if (params.equipment && equipmentCode !== params.equipment) return false;
    return true;
  }

  var events = [];

  // 1/2/3 — lubrication submitted / approved / rejected
  if (wantsType('LUBRICATION_COMPLETED') || wantsType('APPROVED') || wantsType('REJECTED')) {
    readRows_(BOOK.OPERATIONAL, SHEETS.LUBRICATION_HISTORY).forEach(function (r) {
      var lp = pointByLpId[r['LP ID']];
      if (!lp || !equipmentInScope(lp.equipmentIdCode)) return;
      var base = { lpId: lp.lpIdCode, lpIdCode: lp.lpIdCode, equipmentId: lp.equipmentIdCode, equipmentName: lp.assetName, areaName: lp.areaName, contractor: lp.contractor };
      var submittedAt = toDateOrNull_(r['Submitted At']);
      var approvedAt = toDateOrNull_(r['Approved At']);
      var rejectedAt = toDateOrNull_(r['Rejected At']);
      if (wantsType('LUBRICATION_COMPLETED') && inRange(submittedAt) && (!params.technician || r['Technician'] === params.technician)) {
        events.push(Object.assign({}, base, { id: 'lr-sub-' + r['Record ID'], timestamp: submittedAt, eventType: 'LUBRICATION_COMPLETED', actor: r['Technician'] || null, actorId: r['Technician'] || null, detail: 'Lubrication submitted' + (r['Quantity Used (L)'] ? ' (' + r['Quantity Used (L)'] + ' L)' : '') }));
      }
      if (wantsType('APPROVED') && r['Status'] === 'APPROVED' && inRange(approvedAt) && (!params.technician || r['Approved By'] === params.technician)) {
        events.push(Object.assign({}, base, { id: 'lr-app-' + r['Record ID'], timestamp: approvedAt, eventType: 'APPROVED', actor: r['Approved By'] || null, actorId: r['Approved By'] || null, detail: 'Submission approved' }));
      }
      if (wantsType('REJECTED') && r['Status'] === 'REJECTED' && inRange(rejectedAt) && (!params.technician || r['Approved By'] === params.technician)) {
        events.push(Object.assign({}, base, { id: 'lr-rej-' + r['Record ID'], timestamp: rejectedAt, eventType: 'REJECTED', actor: r['Approved By'] || null, actorId: r['Approved By'] || null, detail: r['Rejected Reason'] || 'Submission rejected' }));
      }
    });
  }

  // 4/6/7/8 — overdue flagged / oil-sample-overdue flagged / action created / action closed
  if (wantsType('OVERDUE_FLAGGED') || wantsType('OIL_SAMPLE_OVERDUE_FLAGGED') || wantsType('ACTION_CREATED') || wantsType('ACTION_CLOSED')) {
    readRows_(BOOK.OPERATIONAL, SHEETS.ACTION_PLANS).forEach(function (p) {
      if (!equipmentInScope(p['Equipment'])) return;
      var equip = equipmentMap[p['Equipment']] || {};
      var base = { lpId: null, lpIdCode: null, equipmentId: p['Equipment'], equipmentName: equip['Asset Name'] || p['Equipment'], areaName: equip['Area'] || null, contractor: equip['Contractor'] || null };
      var createdAt = toDateOrNull_(p['Created At']);
      var closedDate = toDateOrNull_(p['Closed Date']);
      var isOverdueType = p['Action Type'] === 'Overdue Lubrication';
      var isOaType = p['Action Type'] === 'Oil Sample Overdue';
      if (inRange(createdAt)) {
        if (wantsType('OVERDUE_FLAGGED') && isOverdueType) events.push(Object.assign({}, base, { id: 'ap-flag-' + p['Action ID'], timestamp: createdAt, eventType: 'OVERDUE_FLAGGED', actor: 'System', actorId: null, detail: p['Description'] }));
        if (wantsType('OIL_SAMPLE_OVERDUE_FLAGGED') && isOaType) events.push(Object.assign({}, base, { id: 'ap-oaflag-' + p['Action ID'], timestamp: createdAt, eventType: 'OIL_SAMPLE_OVERDUE_FLAGGED', actor: 'System', actorId: null, detail: p['Description'] }));
        if (wantsType('ACTION_CREATED') && p['Auto/Manual'] === 'manual' && (!params.technician || p['Created By'] === params.technician)) events.push(Object.assign({}, base, { id: 'ap-create-' + p['Action ID'], timestamp: createdAt, eventType: 'ACTION_CREATED', actor: p['Created By'] || null, actorId: p['Created By'] || null, detail: p['Action Type'] + ': ' + p['Description'] }));
      }
      if (wantsType('ACTION_CLOSED') && inRange(closedDate)) {
        events.push(Object.assign({}, base, { id: 'ap-close-' + p['Action ID'], timestamp: closedDate, eventType: 'ACTION_CLOSED', actor: null, actorId: null, detail: p['Closure Comments'] || (p['Action Type'] + ' closed') }));
      }
    });
  }

  // 5 — oil sample completed
  if (wantsType('OIL_SAMPLE_COMPLETED')) {
    readRows_(BOOK.OPERATIONAL, SHEETS.OIL_SAMPLES).forEach(function (s) {
      var lp = pointByLpId[s['LP ID']];
      if (!lp || !equipmentInScope(lp.equipmentIdCode)) return;
      var uploadedAt = toDateOrNull_(s['Uploaded At']);
      if (!inRange(uploadedAt)) return;
      if (params.technician && s['Uploaded By'] !== params.technician) return;
      events.push({ id: 'os-' + s['Lab Sample ID'], timestamp: uploadedAt, eventType: 'OIL_SAMPLE_COMPLETED', lpId: lp.lpIdCode, lpIdCode: lp.lpIdCode, equipmentId: lp.equipmentIdCode, equipmentName: lp.assetName, areaName: lp.areaName, contractor: lp.contractor, actor: s['Uploaded By'] || null, actorId: s['Uploaded By'] || null, detail: 'Oil sample recorded — ' + s['Report Status'] });
    });
  }

  // 9 — ACC data edit (from Audit Log)
  if (wantsType('ACC_DATA_EDIT')) {
    readRows_(BOOK.OPERATIONAL, SHEETS.AUDIT_LOG).forEach(function (e) {
      if (e['Action Category'] !== 'DATA_EDIT' || e['Entity Type'] !== 'LubricationPoint') return;
      var ts = toDateOrNull_(e['Timestamp']);
      if (!inRange(ts)) return;
      if (orgId && e['Visible To Org'] !== orgId) return;
      if (params.technician && e['Actor Email'] !== params.technician) return;
      var lp = pointByLpId[e['Entity ID']];
      if (params.equipment && (!lp || lp.equipmentIdCode !== params.equipment)) return;
      events.push({ id: 'audit-' + e['Log ID'], timestamp: ts, eventType: 'ACC_DATA_EDIT', lpId: e['Entity ID'], lpIdCode: lp ? lp.lpIdCode : null, equipmentId: lp ? lp.equipmentIdCode : null, equipmentName: lp ? lp.assetName : null, areaName: lp ? lp.areaName : null, contractor: lp ? lp.contractor : null, actor: e['Actor Email'], actorId: e['Actor Email'], detail: e['Reason'] || 'Data corrected' });
    });
  }

  var filtered = params.area ? events.filter(function (e) { return e.areaName === params.area; }) : events;
  filtered.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
  filtered = filtered.slice(0, 300).map(function (e) { return Object.assign({}, e, { timestamp: toIso_(e.timestamp) }); });

  return { events: filtered };
}

// ─────────────────────────────────────────────────────────────────────────
// API: SETTINGS (general key/value + permission templates + notification routing)
// ─────────────────────────────────────────────────────────────────────────

function api_getSettings_(params, user) {
  var rows = readRows_(BOOK.CONFIG, SHEETS.GENERAL_SETTINGS);
  return {
    settings: rows.map(function (r) { return { key: r['Key'], value: r['Value'] === null ? '' : String(r['Value']), editableBy: r['Editable By'] || null }; })
  };
}

function api_updateSetting_(params, user) {
  if (!user.capabilities.manageSettings) throw apiError_(403, 'Missing capability: manageSettings');
  if (params.value === undefined) throw apiError_(400, 'value is required.');
  var updatedRow = updateRowByKey_(BOOK.CONFIG, SHEETS.GENERAL_SETTINGS, 'Key', params.key, { 'Value': params.value });
  if (!updatedRow) throw apiError_(404, 'Setting not found: ' + params.key);
  writeAuditLog_({ actorEmail: user.email, actionCategory: 'PERMISSION_CHANGE', entityType: 'Setting', entityId: params.key, afterValue: { value: params.value }, reason: 'Settings update' });
  return { setting: { key: params.key, value: params.value } };
}

function api_getPermissionTemplates_(params, user) {
  if (!user.capabilities.managePermissions) throw apiError_(403, 'Missing capability: managePermissions');
  var sheet = getSheet_(BOOK.CONFIG, SHEETS.PERMISSION_TEMPLATES);
  var table = readTable_(sheet);
  var titles = readRows_(BOOK.CONFIG, SHEETS.TITLES);

  return {
    templates: table.rows.map(function (row) {
      var screenAccess = {}, capabilities = {};
      table.headers.forEach(function (h) {
        if (!h) return;
        if (h.indexOf('Screen:') === 0) screenAccess[screenKeyFromHeader_(h)] = boolFromYesNo_(row[h]);
        else if (h.indexOf('Can:') === 0) capabilities[capabilityKeyFromHeader_(h)] = boolFromYesNo_(row[h]);
      });
      var titleNames = titles.filter(function (t) { return t['Permission Template'] === row['Title']; }).map(function (t) { return t['Title Name']; });
      return { id: row['Title'], name: row['Title'], dataScope: row['Data Scope'], screenAccess: screenAccess, capabilities: capabilities, titles: titleNames };
    })
  };
}

function api_updatePermissionTemplate_(params, user) {
  if (!user.capabilities.managePermissions) throw apiError_(403, 'Missing capability: managePermissions');
  var sheet = getSheet_(BOOK.CONFIG, SHEETS.PERMISSION_TEMPLATES);
  var table = readTable_(sheet);
  var before = table.rows.filter(function (r) { return r['Title'] === params.id; })[0];
  if (!before) throw apiError_(404, 'Permission template not found.');

  var updates = {};
  if (params.dataScope) updates['Data Scope'] = params.dataScope;
  if (params.screenAccess) {
    table.headers.forEach(function (h) {
      if (h && h.indexOf('Screen:') === 0) {
        var key = screenKeyFromHeader_(h);
        if (params.screenAccess.hasOwnProperty(key)) updates[h] = yesNo_(params.screenAccess[key]);
      }
    });
  }
  if (params.capabilities) {
    table.headers.forEach(function (h) {
      if (h && h.indexOf('Can:') === 0) {
        var key = capabilityKeyFromHeader_(h);
        if (params.capabilities.hasOwnProperty(key)) updates[h] = yesNo_(params.capabilities[key]);
      }
    });
  }

  updateRowByKey_(BOOK.CONFIG, SHEETS.PERMISSION_TEMPLATES, 'Title', params.id, updates);
  writeAuditLog_({ actorEmail: user.email, actionCategory: 'PERMISSION_CHANGE', entityType: 'PermissionTemplate', entityId: params.id, beforeValue: before, afterValue: updates, reason: 'Permission template "' + params.id + '" updated' });

  return { template: api_getPermissionTemplates_({}, user).templates.filter(function (t) { return t.id === params.id; })[0] };
}

function api_getNotificationRouting_(params, user) {
  if (!user.capabilities.manageNotificationRouting) throw apiError_(403, 'Missing capability: manageNotificationRouting');
  var rows = readRows_(BOOK.CONFIG, SHEETS.NOTIFICATION_TYPES);
  return {
    types: rows.map(function (r) {
      var tokens = String(r['Recipients'] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      var channels = String(r['Channels'] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      return { id: r['Name'], name: r['Name'], defaultPriority: r['Default Priority'], rule: { id: r['Name'], recipientTokens: tokens, channels: channels } };
    })
  };
}

function api_updateNotificationRouting_(params, user) {
  if (!user.capabilities.manageNotificationRouting) throw apiError_(403, 'Missing capability: manageNotificationRouting');
  var updates = {};
  if (params.recipientTokens) updates['Recipients'] = params.recipientTokens.join(', ');
  if (params.channels) updates['Channels'] = params.channels.join(', ');
  var updatedRow = updateRowByKey_(BOOK.CONFIG, SHEETS.NOTIFICATION_TYPES, 'Name', params.ruleId, updates);
  if (!updatedRow) throw apiError_(404, 'Notification type not found: ' + params.ruleId);
  writeAuditLog_({ actorEmail: user.email, actionCategory: 'NOTIFICATION_RULE_CHANGE', entityType: 'NotificationRoutingRule', entityId: params.ruleId, afterValue: updates, reason: 'Notification routing rule updated' });
  return { rule: { id: params.ruleId, recipientTokens: params.recipientTokens, channels: params.channels } };
}

// ─────────────────────────────────────────────────────────────────────────
// API: REPORTS — dispatches on params.report
// ─────────────────────────────────────────────────────────────────────────

function api_getReportsData_(params, user) {
  var report = params.report;
  var orgId = user.dataScope === 'ALL_ORGS' ? (params.contractor || null) : (user.organizationId || '__none__');

  if (report === 'compliance') {
    var points = filterLpByOrg_(getLpIndex_(), orgId);
    var overall = computeComplianceStats_(points.map(lpStatusInput_));
    var byArea = {};
    points.forEach(function (p) { var a = p.areaName || 'Unassigned'; (byArea[a] = byArea[a] || []).push(p); });
    var rows = Object.keys(byArea).map(function (area) {
      var stats = computeComplianceStats_(byArea[area].map(lpStatusInput_));
      return { area: area, totalCalendarPoints: stats.totalCalendarPoints, overdue: stats.overdue, compliancePct: stats.compliancePct };
    });
    return { overall: overall, byArea: rows };
  }

  if (report === 'overdue') {
    var points2 = filterLpByOrg_(getLpIndex_(), orgId);
    var rows2 = points2.map(function (p) { return { p: p, status: computeLubricationStatus_(lpStatusInput_(p)) }; })
      .filter(function (x) { return x.status.bucket === 'OVERDUE'; })
      .map(function (x) {
        return { lpIdCode: x.p.lpIdCode, equipment: x.p.assetName, area: x.p.areaName || '', contractor: x.p.contractor || '', daysOverdue: x.status.daysToDue != null ? Math.abs(x.status.daysToDue) : null, nextDue: toIso_(x.status.nextDue) };
      })
      .sort(function (a, b) { return (b.daysOverdue || 0) - (a.daysOverdue || 0); });
    return { rows: rows2 };
  }

  if (report === 'oil-samples') {
    var points3 = filterLpByOrg_(getLpIndex_(), orgId).filter(function (p) { return p.oaRequired; });
    var wantDue = params.status === 'due';
    var rows3 = points3.map(function (p) { return { p: p, status: computeOilAnalysisStatus_(lpStatusInput_(p)) }; })
      .filter(function (x) { return wantDue ? (x.status.bucket === 'DUE_THIS_MONTH' || x.status.bucket === 'DUE_THIS_WEEK') : x.status.bucket === 'OVERDUE'; })
      .map(function (x) { return { lpIdCode: x.p.lpIdCode, equipment: x.p.assetName, contractor: x.p.contractor || '', lastSample: toIso_(x.p.oaLastSampleDate), nextDue: toIso_(x.status.nextDue) }; });
    return { rows: rows3 };
  }

  if (report === 'route-completion') {
    var assignmentWhere = orgId; // Routes carry an Organization column directly
    var routes = readRows_(BOOK.OPERATIONAL, SHEETS.ROUTES);
    var routeById = {}; routes.forEach(function (r) { routeById[r['Route ID']] = r; });
    var execLogs = readRows_(BOOK.OPERATIONAL, SHEETS.ROUTE_EXECUTION_LOG);
    var assignments = readRows_(BOOK.OPERATIONAL, SHEETS.ROUTE_ASSIGNMENTS).filter(function (a) {
      var route = routeById[a['Route ID']];
      if (!route) return false;
      if (assignmentWhere && route['Organization'] !== assignmentWhere) return false;
      return true;
    }).sort(function (a, b) { return toDateOrNull_(b['Assigned Date']) - toDateOrNull_(a['Assigned Date']); });

    var rows4 = assignments.map(function (a) {
      var logs = execLogs.filter(function (l) { return l['Assignment ID'] === a['Assignment ID']; });
      var done = logs.filter(function (l) { return l['Status'] === 'DONE'; }).length;
      var skipped = logs.filter(function (l) { return l['Status'] === 'SKIPPED'; }).length;
      var route = routeById[a['Route ID']] || {};
      return { route: route['Name'] || a['Route ID'], technician: a['Technician'], assignedDate: toIso_(a['Assigned Date']), status: a['Status'], totalPoints: logs.length, done: done, skipped: skipped, completionPct: logs.length ? Math.round((done / logs.length) * 100) : 0 };
    });
    return { rows: rows4 };
  }

  if (report === 'action-plans') {
    var points5 = getLpIndex_();
    var equipmentMap5 = getEquipmentMap_();
    var rows5 = readRows_(BOOK.OPERATIONAL, SHEETS.ACTION_PLANS)
      .filter(function (p) { return !orgId || actionPlanBelongsToOrg_(points5, p, orgId); })
      .filter(function (p) { return !params.status || p['Status'] === params.status; })
      .map(function (p) {
        var equip = equipmentMap5[p['Equipment']] || {};
        return { actionType: p['Action Type'], equipment: equip['Asset Name'] || p['Equipment'], contractor: equip['Contractor'] || '', description: p['Description'], priority: p['Priority'], status: p['Status'], owner: p['Owner'] || '', dueDate: toIso_(p['Due Date']), createdAt: toIso_(p['Created At']), closedDate: toIso_(p['Closed Date']) };
      });
    return { rows: rows5 };
  }

  if (report === 'contractor-comparison') {
    if (user.dataScope !== 'ALL_ORGS') throw apiError_(403, 'ACC/Super Admin only.');
    var orgs = readRows_(BOOK.CONFIG, SHEETS.ORGANIZATIONS).filter(function (o) { return o['Type'] === 'contractor'; });
    var allPoints = getLpIndex_();
    var rows6 = orgs.map(function (org) {
      var pts = filterLpByOrg_(allPoints, org['Name']);
      var stats = computeComplianceStats_(pts.map(lpStatusInput_));
      return { contractor: org['Name'], totalPoints: pts.length, overdue: stats.overdue, compliancePct: stats.compliancePct };
    });
    return { rows: rows6 };
  }

  throw apiError_(400, 'Unknown report: ' + report);
}

// ─────────────────────────────────────────────────────────────────────────
// API: LOOKUPS — dispatches on params.type
// ─────────────────────────────────────────────────────────────────────────

function api_getLookups_(params, user) {
  var type = params.type;

  if (type === 'organizations') {
    return { organizations: readRows_(BOOK.CONFIG, SHEETS.ORGANIZATIONS).map(function (o) { return { id: o['Name'], name: o['Name'], type: o['Type'] }; }) };
  }

  if (type === 'areas') {
    var areas = readRows_(BOOK.CONFIG, SHEETS.AREAS);
    if (user.dataScope !== 'ALL_ORGS') areas = areas.filter(function (a) { return a['Contractor'] === user.organizationId; });
    return { areas: areas.map(function (a) { return { id: a['Area Name'], name: a['Area Name'], locnCode: a['Location Code'], organization: a['Contractor'] }; }) };
  }

  if (type === 'equipment') {
    var equipment = readRows_(BOOK.CONFIG, SHEETS.EQUIPMENT);
    if (user.dataScope !== 'ALL_ORGS') equipment = equipment.filter(function (e) { return e['Contractor'] === user.organizationId; });
    return { equipment: equipment.map(function (e) { return { id: e['Equipment Code'], code: e['Equipment Code'], name: e['Asset Name'], area: e['Area'] || null }; }) };
  }

  if (type === 'lubricant-types') {
    return { lubricantTypes: readRows_(BOOK.CONFIG, SHEETS.LUBRICANT_TYPES).map(function (l) { return { id: l['Name'], name: l['Name'], brand: l['Brand'] || null }; }) };
  }

  if (type === 'technicians') {
    var users = readRows_(BOOK.CONFIG, SHEETS.USERS).filter(function (u) { return String(u['Title'] || '').indexOf('Technician') !== -1; });
    if (user.dataScope !== 'ALL_ORGS') {
      var titles = readRows_(BOOK.CONFIG, SHEETS.TITLES);
      var orgByTitle = {}; titles.forEach(function (t) { orgByTitle[t['Title Name']] = t['Organization']; });
      users = users.filter(function (u) { return orgByTitle[u['Title']] === user.organizationId; });
    }
    return { technicians: users.map(function (u) { return { id: u['Email'], name: u['Name'] }; }) };
  }

  throw apiError_(400, 'Unknown lookup type: ' + type);
}

// ─────────────────────────────────────────────────────────────────────────
// API: USERS & TITLES (Settings screen — user administration)
// ─────────────────────────────────────────────────────────────────────────

function api_getUsers_(params, user) {
  requireScreen_(user, 'settings');
  var users = readRows_(BOOK.CONFIG, SHEETS.USERS);
  var titles = readRows_(BOOK.CONFIG, SHEETS.TITLES);
  var orgByTitle = {}; titles.forEach(function (t) { orgByTitle[t['Title Name']] = t['Organization']; });

  var seeAll = user.dataScope === 'ALL_ORGS' && user.titleName === 'Super Admin';
  if (!seeAll) users = users.filter(function (u) { return orgByTitle[u['Title']] === user.organizationId; });

  return {
    users: users.map(function (u) {
      var org = orgByTitle[u['Title']];
      return { id: u['Email'], name: u['Name'], email: u['Email'], title: u['Title'] || null, organization: org === '(all orgs)' ? null : org, active: boolFromYesNo_(u['Active']), mustChangePassword: boolFromYesNo_(u['Must Change Password']) };
    })
  };
}

function api_getTitles_(params, user) {
  requireScreen_(user, 'settings');
  var titles = readRows_(BOOK.CONFIG, SHEETS.TITLES);
  var seeAll = user.dataScope === 'ALL_ORGS' && user.titleName === 'Super Admin';
  if (!seeAll) titles = titles.filter(function (t) { return t['Organization'] === user.organizationId; });
  return { titles: titles.map(function (t) { return { id: t['Title Name'], name: t['Title Name'], organization: t['Organization'] === '(all orgs)' ? null : t['Organization'] }; }) };
}

function api_createUser_(params, user) {
  requireScreen_(user, 'settings');
  if (!user.capabilities.manageUsers) throw apiError_(403, 'Missing capability: manageUsers');
  if (!params.name || !params.email || !params.titleId) throw apiError_(400, 'name, email, and titleId are required.');

  if (user.titleName !== 'Super Admin' && params.organizationId !== user.organizationId) {
    throw apiError_(403, 'You can only create users within your own organization.');
  }
  if (findUserRowByEmail_(params.email)) throw apiError_(400, 'A user with this email already exists.');

  var tempPassword = Math.random().toString(36).slice(-10) + 'A1!';
  var salt = makeSalt_();
  var hash = hashPassword_(tempPassword, salt);

  appendRowObj_(BOOK.CONFIG, SHEETS.USERS, {
    'Email': params.email, 'Name': params.name, 'Title': params.titleId,
    'Organization': params.organizationId || '', 'Active': 'Yes', 'Must Change Password': 'Yes',
    'Password Hash': hash, 'Password Salt': salt
  });

  return { user: { id: params.email, name: params.name, email: params.email }, temporaryPassword: tempPassword };
}

function api_updateUserActive_(params, user) {
  requireScreen_(user, 'settings');
  if (!user.capabilities.manageUsers) throw apiError_(403, 'Missing capability: manageUsers');
  var target = findUserRowByEmail_(params.id);
  if (!target) throw apiError_(404, 'User not found.');
  if (user.titleName !== 'Super Admin') {
    var titles = readRows_(BOOK.CONFIG, SHEETS.TITLES);
    var orgByTitle = {}; titles.forEach(function (t) { orgByTitle[t['Title Name']] = t['Organization']; });
    if (orgByTitle[target['Title']] !== user.organizationId) throw apiError_(403, "Not authorized for this organization's users.");
  }
  updateRowByKey_(BOOK.CONFIG, SHEETS.USERS, 'Email', params.id, { 'Active': yesNo_(!!params.active) });
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────
// API: AUDIT LOG
// ─────────────────────────────────────────────────────────────────────────

function api_getAuditLog_(params, user) {
  var rows = readRows_(BOOK.OPERATIONAL, SHEETS.AUDIT_LOG);
  if (!user.capabilities.viewAuditLog) rows = rows.filter(function (r) { return r['Visible To Org'] === user.organizationId; });
  rows.sort(function (a, b) { return toDateOrNull_(b['Timestamp']) - toDateOrNull_(a['Timestamp']); });
  return {
    entries: rows.slice(0, 500).map(function (e) {
      return { id: e['Log ID'], actor: e['Actor Email'], actionCategory: e['Action Category'], entityType: e['Entity Type'], entityId: e['Entity ID'], before: e['Before Value'] || null, after: e['After Value'] || null, reason: e['Reason'] || null, timestamp: toIso_(e['Timestamp']) };
    })
  };
}

// ─────────────────────────────────────────────────────────────────────────
// API: OIL MANAGEMENT CENTER (consumption / forecast / purchase log)
// ─────────────────────────────────────────────────────────────────────────

function api_getOilConsumption_(params, user) {
  requireScreen_(user, 'oil_management_center');
  var orgId = user.dataScope === 'ALL_ORGS' ? (params.contractor || null) : (user.organizationId || '__none__');
  var fromDate = params.from ? new Date(params.from) : new Date(new Date().getFullYear(), 0, 1);
  var toDate = params.to ? new Date(params.to) : new Date();
  var rangeDays = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000));
  var groupBy = params.groupBy || 'lubricant';

  var points = filterLpByOrg_(getLpIndex_(), orgId);
  var pointByLpId = {}; points.forEach(function (p) { pointByLpId[p.lpIdCode] = p; });

  var records = readRows_(BOOK.OPERATIONAL, SHEETS.LUBRICATION_HISTORY).filter(function (r) {
    if (r['Status'] !== 'APPROVED') return false;
    var d = toDateOrNull_(r['Lubrication Date']);
    if (!d || d < fromDate || d > toDate) return false;
    return !!pointByLpId[r['LP ID']];
  });

  function groupKey(lubricantTypeName, areaName, equipmentName) {
    if (groupBy === 'area') return areaName || 'Unassigned';
    if (groupBy === 'equipment') return equipmentName || 'Unknown';
    return lubricantTypeName || 'Unspecified';
  }

  var buckets = {};
  points.forEach(function (p) {
    if (String(p.frequencyType).toLowerCase() !== 'calendar' || !p.frequencyIntervalDays || !p.standardQuantityL) return;
    var occurrences = rangeDays / p.frequencyIntervalDays;
    var key = groupKey(p.lubricantType, p.areaName, p.assetName);
    buckets[key] = buckets[key] || { planned: 0, actual: 0 };
    buckets[key].planned += p.standardQuantityL * occurrences;
  });
  records.forEach(function (r) {
    if (!r['Quantity Used (L)']) return;
    var lp = pointByLpId[r['LP ID']];
    var key = groupKey(lp.lubricantType, lp.areaName, lp.assetName);
    buckets[key] = buckets[key] || { planned: 0, actual: 0 };
    buckets[key].actual += Number(r['Quantity Used (L)']);
  });

  return {
    from: toIso_(fromDate), to: toIso_(toDate), groupBy: groupBy,
    rows: Object.keys(buckets).map(function (key) {
      var v = buckets[key];
      return { key: key, plannedL: Math.round(v.planned * 10) / 10, actualL: Math.round(v.actual * 10) / 10, varianceL: Math.round((v.actual - v.planned) * 10) / 10 };
    })
  };
}

function api_getOilForecast_(params, user) {
  requireScreen_(user, 'oil_management_center');
  var organizationId = user.dataScope === 'ALL_ORGS' ? params.organizationId : user.organizationId;
  if (!organizationId) throw apiError_(400, 'organizationId is required.');

  var points = filterLpByOrg_(getLpIndex_(), organizationId).filter(function (p) { return String(p.frequencyType).toLowerCase() === 'calendar'; });
  var buckets = {};
  points.forEach(function (p) {
    var bucket = computeLubricationStatus_(lpStatusInput_(p)).bucket;
    if (['OVERDUE', 'DUE_TODAY', 'DUE_THIS_WEEK', 'DUE_THIS_MONTH'].indexOf(bucket) !== -1) {
      var key = p.lubricantType || 'Unspecified';
      buckets[key] = (buckets[key] || 0) + (p.standardQuantityL || 0);
    }
  });
  var forecast = Object.keys(buckets).map(function (k) { return { lubricantType: k, quantityL: Math.round(buckets[k] * 10) / 10 }; });

  notify_({ typeName: '30-Day Oil Need Forecast', organizationId: organizationId, message: '30-day oil forecast generated: ' + forecast.length + ' lubricant type(s) needed for upcoming due/overdue points.' });

  return { forecast: forecast };
}

function api_getPurchaseLog_(params, user) {
  requireScreen_(user, 'oil_management_center');
  var rows = readRows_(BOOK.OPERATIONAL, SHEETS.OIL_PURCHASE_LOG);
  if (user.dataScope !== 'ALL_ORGS') rows = rows.filter(function (r) { return r['Organization'] === user.organizationId; });
  rows.sort(function (a, b) { return toDateOrNull_(b['Purchase Date']) - toDateOrNull_(a['Purchase Date']); });
  return { purchases: rows.map(function (r) { return { id: r['Purchase ID'], organization: r['Organization'], lubricantType: r['Lubricant Type'], quantityL: r['Quantity (L)'], purchaseDate: toIso_(r['Purchase Date']), loggedBy: r['Logged By'] || null }; }) };
}

function api_createPurchaseLog_(params, user) {
  requireScreen_(user, 'oil_management_center');
  if (!user.capabilities.managePurchaseLog) throw apiError_(403, 'Missing capability: managePurchaseLog');
  if (!user.organizationId) throw apiError_(400, 'Your account has no organization assigned.');
  if (!params.lubricantTypeId || !params.quantityL || !params.purchaseDate) throw apiError_(400, 'lubricantTypeId, quantityL, and purchaseDate are required.');

  var id;
  withScriptLock_(function () {
    id = nextSequentialId_(BOOK.OPERATIONAL, SHEETS.OIL_PURCHASE_LOG, 'Purchase ID', 'PUR-', 4);
    appendRowObj_(BOOK.OPERATIONAL, SHEETS.OIL_PURCHASE_LOG, {
      'Purchase ID': id, 'Organization': user.organizationId, 'Lubricant Type': params.lubricantTypeId,
      'Quantity (L)': Number(params.quantityL), 'Purchase Date': new Date(params.purchaseDate), 'Logged By': user.name
    });
  });
  return { purchase: { id: id, status: 'logged' } };
}

// ─────────────────────────────────────────────────────────────────────────
// API: OIL SAMPLE CENTER (list / detail / trend / create — PDF extraction
// is OUT OF SCOPE for this migration; see MIGRATION_CHECKLIST.md)
// ─────────────────────────────────────────────────────────────────────────

function api_getOilSamples_(params, user) {
  requireScreen_(user, 'oil_sample_center');
  var points = getLpIndex_();
  var orgId = user.dataScope !== 'ALL_ORGS' ? user.organizationId : (params.contractor || null);
  var inScope = filterLpByOrg_(points, orgId);
  var lpIds = {}; inScope.forEach(function (p) { lpIds[p.lpIdCode] = p; });

  var rows = readRows_(BOOK.OPERATIONAL, SHEETS.OIL_SAMPLES).filter(function (s) { return lpIds[s['LP ID']]; });
  if (params.status) rows = rows.filter(function (s) { return s['Report Status'] === params.status; });
  rows.sort(function (a, b) { return toDateOrNull_(b['Sampled Date']) - toDateOrNull_(a['Sampled Date']); });

  return {
    samples: rows.map(function (s) {
      var lp = lpIds[s['LP ID']] || {};
      return { id: s['Lab Sample ID'], lpIdCode: s['LP ID'], equipment: lp.assetName || s['Equipment'], sampledDate: toIso_(s['Sampled Date']), reportStatus: s['Report Status'], recommendations: s['Recommendations'] || null };
    })
  };
}

function api_getOilSampleById_(params, user) {
  requireScreen_(user, 'oil_sample_center');
  var sample = readRows_(BOOK.OPERATIONAL, SHEETS.OIL_SAMPLES).filter(function (s) { return s['Lab Sample ID'] === params.id; })[0];
  if (!sample) throw apiError_(404, 'Oil sample not found.');
  var parameters = readRows_(BOOK.OPERATIONAL, SHEETS.OIL_SAMPLE_PARAMETERS).filter(function (p) { return p['Lab Sample ID'] === params.id; });
  return {
    id: sample['Lab Sample ID'], lpIdCode: sample['LP ID'], equipment: sample['Equipment'],
    sampledDate: toIso_(sample['Sampled Date']), reportStatus: sample['Report Status'],
    recommendations: sample['Recommendations'] || null, sourcePdfUrl: sample['Source PDF URL'] || null,
    parameters: parameters.map(function (p) { return { group: p['Parameter Group'], key: p['Parameter Key'], label: p['Parameter Label'], unit: p['Unit'] || null, value: p['Value'], status: p['Status'] }; })
  };
}

function api_getOilSampleTrend_(params, user) {
  requireScreen_(user, 'oil_sample_center');
  var samples = readRows_(BOOK.OPERATIONAL, SHEETS.OIL_SAMPLES).filter(function (s) { return s['LP ID'] === params.lpId; })
    .sort(function (a, b) { return toDateOrNull_(a['Sampled Date']) - toDateOrNull_(b['Sampled Date']); });
  var sampleIds = {}; samples.forEach(function (s) { sampleIds[s['Lab Sample ID']] = true; });
  var allParams = readRows_(BOOK.OPERATIONAL, SHEETS.OIL_SAMPLE_PARAMETERS).filter(function (p) { return sampleIds[p['Lab Sample ID']]; });
  return {
    samples: samples.map(function (s) { return { id: s['Lab Sample ID'], sampledDate: toIso_(s['Sampled Date']), reportStatus: s['Report Status'] }; }),
    parameters: allParams.map(function (p) { return { sampleId: p['Lab Sample ID'], key: p['Parameter Key'], label: p['Parameter Label'], unit: p['Unit'] || null, value: p['Value'], status: p['Status'] }; })
  };
}

function api_createOilSample_(params, user) {
  requireScreen_(user, 'oil_sample_center');
  if (!params.lpId || !params.sampledDate) throw apiError_(400, 'lpId and sampledDate are required.');
  var points = getLpIndex_();
  var lp = points.filter(function (p) { return p.lpIdCode === params.lpId; })[0];
  if (!lp) throw apiError_(404, 'Lubrication point not found.');

  var id = params.sampleIdLab || ('LAB-' + new Date().getTime());
  appendRowObj_(BOOK.OPERATIONAL, SHEETS.OIL_SAMPLES, {
    'Lab Sample ID': id, 'LP ID': lp.lpIdCode, 'Equipment': lp.assetName, 'Sampled Date': new Date(params.sampledDate),
    'Report Status': params.reportStatus || 'NORMAL', 'Recommendations': params.recommendations || '',
    'Source PDF URL': params.sourcePdfUrl || '', 'Uploaded By': user.name, 'Uploaded At': new Date()
  });
  (params.parameters || []).forEach(function (p) {
    appendRowObj_(BOOK.OPERATIONAL, SHEETS.OIL_SAMPLE_PARAMETERS, {
      'Lab Sample ID': id, 'Parameter Group': p.group || '', 'Parameter Key': p.key, 'Parameter Label': p.label || p.key,
      'Unit': p.unit || '', 'Value': p.value === undefined ? '' : p.value, 'Status': p.status || 'NORMAL'
    });
  });
  // Keep the point's cached oil-analysis fields current.
  updateRowByKey_(BOOK.OPERATIONAL, SHEETS.LUBRICATION_POINTS, 'LP ID', lp.lpIdCode, { 'Last Oil Sample Date': new Date(params.sampledDate) });

  return { sample: { id: id, lpId: lp.lpIdCode } };
}

// ─────────────────────────────────────────────────────────────────────────
// API: ROUTE CENTER (static + dynamic routes, assignments, execution)
// ─────────────────────────────────────────────────────────────────────────

function api_getRoutes_(params, user) {
  requireScreen_(user, 'route_center');
  var orgId = user.dataScope !== 'ALL_ORGS' ? user.organizationId : (params.contractor || null);
  var rows = readRows_(BOOK.OPERATIONAL, SHEETS.ROUTES);
  if (orgId) rows = rows.filter(function (r) { return r['Organization'] === orgId; });
  return {
    routes: rows.map(function (r) {
      var lpIds = String(r['LP IDs'] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      return { id: r['Route ID'], organization: r['Organization'], name: r['Name'], type: r['Type'], lpIds: lpIds, pointCount: lpIds.length };
    })
  };
}

function api_getDynamicRoutePreview_(params, user) {
  requireScreen_(user, 'route_center');
  var orgId = user.dataScope !== 'ALL_ORGS' ? user.organizationId : (params.contractor || null);
  var points = filterLpByOrg_(getLpIndex_(), orgId);
  var due = points.filter(function (p) {
    var bucket = computeLubricationStatus_(lpStatusInput_(p)).bucket;
    return ['OVERDUE', 'DUE_TODAY', 'DUE_THIS_WEEK'].indexOf(bucket) !== -1;
  });
  if (params.area) due = due.filter(function (p) { return p.areaName === params.area; });
  return { preview: due.map(function (p) { return { lpId: p.lpIdCode, equipment: p.assetName, area: p.areaName, status: computeLubricationStatus_(lpStatusInput_(p)).bucket }; }) };
}

function api_createRoute_(params, user) {
  requireScreen_(user, 'route_center');
  if (!user.capabilities.manageRoutes) throw apiError_(403, 'Missing capability: manageRoutes');
  if (!params.name || !params.organization) throw apiError_(400, 'name and organization are required.');
  var id;
  withScriptLock_(function () {
    id = nextSequentialId_(BOOK.OPERATIONAL, SHEETS.ROUTES, 'Route ID', 'RT-', 3);
    appendRowObj_(BOOK.OPERATIONAL, SHEETS.ROUTES, {
      'Route ID': id, 'Organization': params.organization, 'Name': params.name,
      'Type': params.type || 'Static', 'LP IDs': (params.lpIds || []).join(', ')
    });
  });
  return { route: { id: id } };
}

function api_assignRoute_(params, user) {
  requireScreen_(user, 'route_center');
  if (!user.capabilities.manageRoutes) throw apiError_(403, 'Missing capability: manageRoutes');
  if (!params.technician || !params.assignedDate) throw apiError_(400, 'technician and assignedDate are required.');

  var route = readRows_(BOOK.OPERATIONAL, SHEETS.ROUTES).filter(function (r) { return r['Route ID'] === params.routeId; })[0];
  if (!route) throw apiError_(404, 'Route not found.');

  var id;
  withScriptLock_(function () {
    id = nextSequentialId_(BOOK.OPERATIONAL, SHEETS.ROUTE_ASSIGNMENTS, 'Assignment ID', 'ASG-', 4);
    appendRowObj_(BOOK.OPERATIONAL, SHEETS.ROUTE_ASSIGNMENTS, {
      'Assignment ID': id, 'Route ID': params.routeId, 'Technician': params.technician,
      'Assigned Date': new Date(params.assignedDate), 'Status': 'ASSIGNED', 'Started At': '', 'Completed At': ''
    });
  });

  var lpIds = String(route['LP IDs'] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  lpIds.forEach(function (lpId) {
    appendRowObj_(BOOK.OPERATIONAL, SHEETS.ROUTE_EXECUTION_LOG, { 'Assignment ID': id, 'LP ID': lpId, 'Status': 'PENDING', 'Skip Reason': '', 'Completed At': '' });
  });

  return { assignment: { id: id, routeId: params.routeId, pointCount: lpIds.length } };
}

function api_getMyAssignments_(params, user) {
  var assignments = readRows_(BOOK.OPERATIONAL, SHEETS.ROUTE_ASSIGNMENTS).filter(function (a) { return a['Technician'] === user.name; });
  var execLogs = readRows_(BOOK.OPERATIONAL, SHEETS.ROUTE_EXECUTION_LOG);
  var routes = readRows_(BOOK.OPERATIONAL, SHEETS.ROUTES);
  var routeById = {}; routes.forEach(function (r) { routeById[r['Route ID']] = r; });

  return {
    assignments: assignments.map(function (a) {
      var logs = execLogs.filter(function (l) { return l['Assignment ID'] === a['Assignment ID']; });
      var route = routeById[a['Route ID']] || {};
      return { id: a['Assignment ID'], routeName: route['Name'] || a['Route ID'], assignedDate: toIso_(a['Assigned Date']), status: a['Status'], points: logs.map(function (l) { return { lpId: l['LP ID'], status: l['Status'] }; }) };
    })
  };
}

function api_startAssignment_(params, user) {
  var a = readRows_(BOOK.OPERATIONAL, SHEETS.ROUTE_ASSIGNMENTS).filter(function (x) { return x['Assignment ID'] === params.id; })[0];
  if (!a || a['Technician'] !== user.name) throw apiError_(404, 'Assignment not found.');
  updateRowByKey_(BOOK.OPERATIONAL, SHEETS.ROUTE_ASSIGNMENTS, 'Assignment ID', params.id, { 'Status': 'IN_PROGRESS', 'Started At': new Date() });
  return { success: true };
}

function api_completeAssignmentPoint_(params, user) {
  var sheet = getSheet_(BOOK.OPERATIONAL, SHEETS.ROUTE_EXECUTION_LOG);
  var table = readTable_(sheet);
  var row = table.rows.filter(function (r) { return r['Assignment ID'] === params.id && r['LP ID'] === params.lpId; })[0];
  if (!row) throw apiError_(404, 'Route execution row not found.');
  ['Status', 'Completed At'].forEach(function (h) {
    var colIdx = table.headers.indexOf(h);
    sheet.getRange(row.__row, colIdx + 1).setValue(h === 'Status' ? 'DONE' : new Date());
  });
  SpreadsheetApp.flush();
  return { success: true };
}

function api_skipAssignmentPoint_(params, user) {
  if (!params.reason) throw apiError_(400, 'A skip reason is required.');
  var sheet = getSheet_(BOOK.OPERATIONAL, SHEETS.ROUTE_EXECUTION_LOG);
  var table = readTable_(sheet);
  var row = table.rows.filter(function (r) { return r['Assignment ID'] === params.id && r['LP ID'] === params.lpId; })[0];
  if (!row) throw apiError_(404, 'Route execution row not found.');
  sheet.getRange(row.__row, table.headers.indexOf('Status') + 1).setValue('SKIPPED');
  sheet.getRange(row.__row, table.headers.indexOf('Skip Reason') + 1).setValue(params.reason);
  sheet.getRange(row.__row, table.headers.indexOf('Completed At') + 1).setValue(new Date());
  SpreadsheetApp.flush();

  notify_({ typeName: 'Route Point Skipped', organizationId: user.organizationId, message: user.name + ' skipped ' + params.lpId + ': ' + params.reason, relatedEntityType: 'RouteExecutionLog', relatedEntityId: params.id });
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────
// FUNCTION REGISTRY — fn name -> { handler, auth, screen, capability }
// auth defaults to true (session token required) unless explicitly false.
// screen/capability, if set, are enforced before the handler runs; handlers
// that already self-check (see comments) leave these unset to avoid a
// redundant check.
// ─────────────────────────────────────────────────────────────────────────

var FUNCTION_MAP = {
  // Auth
  loginUser: { handler: api_loginUser_, auth: false },
  changePassword: { handler: api_changePassword_ },
  getMe: { handler: api_getMe_ },

  // Dashboard
  getDashboardData: { handler: api_getDashboardData_, screen: 'dashboard' },

  // Lubrication Points
  getLubricationPoints: { handler: api_getLubricationPoints_, screen: 'lubrication_explorer' },
  getLubricationPointById: { handler: api_getLubricationPointById_, screen: 'lp_details' },
  updateLubricationPoint: { handler: api_updateLubricationPoint_ },

  // Lubrication Records
  submitLubrication: { handler: api_submitLubrication_ },
  getPendingApprovals: { handler: api_getPendingApprovals_, screen: 'pending_approvals' },
  approveLubrication: { handler: api_approveLubrication_ },
  rejectLubrication: { handler: api_rejectLubrication_ },

  // Action Plans
  getActionPlans: { handler: api_getActionPlans_, screen: 'action_plan_center' },
  createActionPlan: { handler: api_createActionPlan_, screen: 'action_plan_center' },
  closeActionPlan: { handler: api_closeActionPlan_, screen: 'action_plan_center' },
  updateActionPlanStatus: { handler: api_updateActionPlanStatus_, screen: 'action_plan_center' },

  // Notifications
  getNotifications: { handler: api_getNotifications_ },
  markNotificationRead: { handler: api_markNotificationRead_ },
  markAllNotificationsRead: { handler: api_markAllNotificationsRead_ },
  archiveNotification: { handler: api_archiveNotification_ },

  // Timeline
  getTimeline: { handler: api_getTimeline_, screen: 'lubrication_timeline' },

  // Settings
  getSettings: { handler: api_getSettings_ },
  updateSetting: { handler: api_updateSetting_ },
  getPermissionTemplates: { handler: api_getPermissionTemplates_ },
  updatePermissionTemplate: { handler: api_updatePermissionTemplate_ },
  getNotificationRouting: { handler: api_getNotificationRouting_ },
  updateNotificationRouting: { handler: api_updateNotificationRouting_ },

  // Reports
  getReportsData: { handler: api_getReportsData_, screen: 'reports_center' },

  // Lookups
  getLookups: { handler: api_getLookups_ },

  // Users & Titles
  getUsers: { handler: api_getUsers_ },
  getTitles: { handler: api_getTitles_ },
  createUser: { handler: api_createUser_ },
  updateUserActive: { handler: api_updateUserActive_ },

  // Audit Log
  getAuditLog: { handler: api_getAuditLog_ },

  // Oil Management Center
  getOilConsumption: { handler: api_getOilConsumption_ },
  getOilForecast: { handler: api_getOilForecast_ },
  getPurchaseLog: { handler: api_getPurchaseLog_ },
  createPurchaseLog: { handler: api_createPurchaseLog_ },

  // Oil Sample Center (PDF extraction intentionally not implemented)
  getOilSamples: { handler: api_getOilSamples_ },
  getOilSampleById: { handler: api_getOilSampleById_ },
  getOilSampleTrend: { handler: api_getOilSampleTrend_ },
  createOilSample: { handler: api_createOilSample_ },

  // Route Center
  getRoutes: { handler: api_getRoutes_ },
  getDynamicRoutePreview: { handler: api_getDynamicRoutePreview_ },
  createRoute: { handler: api_createRoute_ },
  assignRoute: { handler: api_assignRoute_ },
  getMyAssignments: { handler: api_getMyAssignments_ },
  startAssignment: { handler: api_startAssignment_ },
  completeAssignmentPoint: { handler: api_completeAssignmentPoint_ },
  skipAssignmentPoint: { handler: api_skipAssignmentPoint_ }
};

// ─────────────────────────────────────────────────────────────────────────
// ADMIN / ONE-TIME SETUP UTILITIES
// Run these from the Apps Script editor (select the function in the
// dropdown, click Run) — they are not exposed over the Web App.
// ─────────────────────────────────────────────────────────────────────────

/**
 * STEP 1 of manual setup. Adds "Password Hash" and "Password Salt" columns
 * to the end of the Users tab if they don't already exist. Purely additive
 * — does not touch any existing column or any existing row's data in the
 * other columns. Safe to run more than once (no-ops if columns exist).
 */
function bootstrapAddPasswordColumns() {
  var sheet = getSheet_(BOOK.CONFIG, SHEETS.USERS);
  var headerRow = findHeaderRow_(sheet);
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];

  var toAdd = ['Password Hash', 'Password Salt'].filter(function (h) { return headers.indexOf(h) === -1; });
  toAdd.forEach(function (h, i) {
    sheet.getRange(headerRow, lastCol + 1 + i).setValue(h);
  });
  SpreadsheetApp.flush();
  Logger.log(toAdd.length ? ('Added columns: ' + toAdd.join(', ')) : 'Password Hash / Password Salt already present — nothing to do.');
}

/**
 * STEP 2 of manual setup. Sets (or resets) one user's password. Run once
 * per existing account after bootstrapAddPasswordColumns, e.g.:
 *   adminSetPassword_('superadmin@acc-oil.app', 'ChangeMe123!');
 * Every user should change this password on first login (the Users tab's
 * "Must Change Password" column already controls that prompt).
 */
function adminSetPassword_(email, newPassword) {
  var userRow = findUserRowByEmail_(email);
  if (!userRow) throw new Error('No user found with email: ' + email);
  var salt = makeSalt_();
  var hash = hashPassword_(newPassword, salt);
  updateRowByKey_(BOOK.CONFIG, SHEETS.USERS, 'Email', email, { 'Password Hash': hash, 'Password Salt': salt });
  Logger.log('Password set for ' + email);
}

/** Convenience: sets the same temporary password for every existing user in
 * one pass. Each account still has "Must Change Password" = Yes (per the
 * existing sheet data), so everyone is forced to pick their own on first
 * login. Run this ONCE right after bootstrapAddPasswordColumns. */
function bootstrapSetAllInitialPasswords_(temporaryPassword) {
  var users = readRows_(BOOK.CONFIG, SHEETS.USERS);
  users.forEach(function (u) { adminSetPassword_(u['Email'], temporaryPassword || 'AccOil2026!'); });
  Logger.log('Initial password set for ' + users.length + ' users.');
}

/** Generates a random value suitable for the TOKEN_SECRET script property. */
function generateTokenSecret_() {
  var secret = Utilities.getUuid() + Utilities.getUuid();
  Logger.log('Paste this into Script Properties as TOKEN_SECRET:\n' + secret);
  return secret;
}

/** Adds a small "ACC Oil Admin" menu to the bound Sheet's UI for the common
 * one-time setup actions, so a non-developer can run them without opening
 * the Apps Script editor's function dropdown. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ACC Oil Admin')
    .addItem('1. Add password columns to Users', 'bootstrapAddPasswordColumns')
    .addItem('2. Set a user password…', 'promptSetPassword_')
    .addItem('3. Generate a new TOKEN_SECRET (logs it — copy into Script Properties)', 'generateTokenSecret_')
    .addToUi();
}

function promptSetPassword_() {
  var ui = SpreadsheetApp.getUi();
  var emailResp = ui.prompt('Set user password', 'User email:', ui.ButtonSet.OK_CANCEL);
  if (emailResp.getSelectedButton() !== ui.Button.OK) return;
  var pwResp = ui.prompt('Set user password', 'New password (min 8 chars):', ui.ButtonSet.OK_CANCEL);
  if (pwResp.getSelectedButton() !== ui.Button.OK) return;
  try {
    adminSetPassword_(emailResp.getResponseText().trim(), pwResp.getResponseText());
    ui.alert('Password set for ' + emailResp.getResponseText().trim());
  } catch (e) {
    ui.alert('Error: ' + e.message);
  }
}
