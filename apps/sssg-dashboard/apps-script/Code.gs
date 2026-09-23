/**
 * OPSIONAL — dipakai hanya bila spreadsheet TIDAK boleh dibagikan "Siapa saja yang memiliki link".
 * 1) Buka spreadsheet → Ekstensi → Apps Script → tempel kode ini → Simpan.
 * 2) Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone → Deploy → salin URL.
 * 3) Tempel URL ke APPS_SCRIPT_URL di public/config.js lalu deploy ulang hosting.
 */
function doGet(e) {
  var name = (e && e.parameter && e.parameter.sheet) || "";
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.getSheetByName(name + " ") || ss.getSheetByName(name.trim());
  var out;
  if (!sh) out = { error: "Sheet tidak ditemukan: " + name };
  else {
    var values = sh.getDataRange().getValues().map(function (r) {
      return r.map(function (v) { return (v instanceof Date) ? "Date(" + v.getFullYear() + "," + v.getMonth() + "," + v.getDate() + ")" : (v === "" ? null : v); });
    });
    out = { sheet: sh.getName(), values: values };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
