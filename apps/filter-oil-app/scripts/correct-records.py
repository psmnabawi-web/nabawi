#!/usr/bin/env python3
"""Koreksi filterRecords yang salah slot karena bug "foto lewat tengah malam" (aturan baru = hari operasional berganti 05:00 WIB).

Aturan keamanan Firestore hanya mengizinkan app MEMBUAT record; mengubah/menghapus butuh akses owner. Jalankan di Cloud Shell
akun owner dengan token: FO_TOKEN="$(gcloud auth print-access-token)" python3 scripts/correct-records.py fix-all

  correct-records.py plan                 → baca semua record, tampilkan rencana (TIDAK mengubah apa pun)
  correct-records.py fix-all              → pindahkan semua record di rencana yang slot tujuannya kosong + arsipkan duplikat yang disetujui
  correct_records.py apply ID [ID ...]    → pindahkan record tertentu sesuai rencana (salin semua field + foto ke slot benar,
                                            tambah catatan slotCorrection, lalu hapus record lama dengan precondition updateTime)
  correct_records.py archive ID REASON    → tandai record duplikat sebagai dedupArchived=true (tidak dihapus)

Aturan slot sama persis dengan app.js hasil tambalan: jam WIB (EXIF = jam lokal foto; sumber lain dari waktu absolut),
hari operasional berganti settings.dayCutoff (default 05:00), slot terdekat di hari operasional yang sama, toleransi dari settings.
Aman diulang: bila record tujuan sudah ada dan berasal dari record lama yang sama (slotCorrection.fromRecordId + foto identik),
pembuatan dilewati dan langsung lanjut menghapus record lama."""
import datetime, json, os, re, subprocess, sys, tempfile

B = "https://firestore.googleapis.com/v1/projects/trecking-filter-oil-store/databases/(default)/documents"
HERE = os.path.dirname(os.path.abspath(__file__))
TMP = os.environ.get("TMPDIR") or HERE
BACKUP_DIR = os.path.join(HERE, "backup")
DAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]
WIB = datetime.timezone(datetime.timedelta(hours=7))


def curl(method, url, body=None):
    args = ["curl", "-sS", "-m", "120", "-X", method, "-H", "Content-Type: application/json", "-w", "\n%{http_code}"]
    if os.environ.get("FO_TOKEN"): args += ["-H", "Authorization: Bearer " + os.environ["FO_TOKEN"]]
    tmp = None
    if body is not None:  # lewat file: isi dengan foto bisa > 128 KB (batas satu argumen command line)
        tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, dir=TMP)
        json.dump(body, tmp); tmp.close()
        args += ["--data-binary", "@" + tmp.name]
    try:
        out = subprocess.run(args + [url], capture_output=True, text=True).stdout
    finally:
        if tmp: os.unlink(tmp.name)
    text, _, code = out.rpartition("\n")
    try: data = json.loads(text) if text.strip() else {}
    except json.JSONDecodeError: data = {"raw": text[:300]}
    return int(code or 0), data


def val(v):
    return next(iter(v.values())) if isinstance(v, dict) and v else None


def settings():
    code, d = curl("GET", f"{B}/settings/app")
    if code != 200: sys.exit(f"settings/app tidak terbaca ({code})")
    f = {k: val(v) for k, v in d["fields"].items()}
    mins = lambda t: int(t.split(":")[0]) * 60 + int(t.split(":")[1])
    return {
        "slots": [("FILTER-1", "FILTER 1", f.get("slot1", "09:00")), ("FILTER-2", "FILTER 2", f.get("slot2", "16:00")), ("FILTER-3", "FILTER 3", f.get("slot3", "23:30"))],
        "tol": int(float(f.get("toleranceMin", 30) or 30)), "cut": mins(f.get("dayCutoff", "05:00") or "05:00"), "mins": mins,
    }


def wall_clock(f):
    """Jam dinding WIB foto, sama dengan wibWall() di app."""
    src = str(val(f.get("evidenceTimeSource")) or "")
    epoch = val(f.get("evidenceEpochMs"))
    if src.startswith("EXIF") or epoch is None:
        return datetime.datetime.fromisoformat(str(val(f.get("evidenceLocalIso")))[:19])
    return datetime.datetime.fromtimestamp(int(epoch) / 1000, WIB).replace(tzinfo=None)


def rule(f, S):
    w = wall_clock(f)
    now = w.hour * 60 + w.minute
    op = lambda m: m + 1440 if m < S["cut"] else m
    base = -1 if now < S["cut"] else 0
    best = None
    for sid, label, t in S["slots"]:
        d = op(now) - op(S["mins"](t))
        if best is None or abs(d) < abs(best[3]): best = (sid, label, t, d)
    sid, label, t, d = best
    day = (w.date() + datetime.timedelta(days=base))
    status = "ON TIME" if abs(d) <= S["tol"] else ("EARLY" if d < 0 else "LATE")
    if val(f.get("integrity")) == "REVIEW": status = "REVIEW"
    return {"slotId": sid, "label": label, "planned": t, "dateKey": day.isoformat(), "dayName": DAYS[day.weekday()], "dev": d, "status": status, "wall": w}


def all_records():
    q = {"structuredQuery": {"from": [{"collectionId": "filterRecords"}], "select": {"fields": [{"fieldPath": k} for k in
         ["dateKey", "slotId", "storeId", "storeName", "crewName", "status", "deviationMin", "evidenceLocalIso", "evidenceEpochMs",
          "evidenceTimeSource", "integrity", "dedupArchived", "slotCorrection"]]}}}
    code, rows = curl("POST", f"{B}:runQuery", q)
    if code != 200: sys.exit(f"runQuery gagal {code}")
    return [{"_id": r["document"]["name"].rsplit("/", 1)[1], **r["document"]["fields"]} for r in rows if r.get("document")]


def plan(S, recs=None):
    recs = recs or all_records()
    live = {(val(r["dateKey"]), val(r["storeId"]), val(r["slotId"])): r for r in recs if val(r.get("dedupArchived")) is not True}
    moved_from = lambda r: val(((r or {}).get("slotCorrection") or {}).get("mapValue", {}).get("fields", {}).get("fromRecordId"))
    out = []
    for r in recs:
        if val(r.get("dedupArchived")) is True or not val(r.get("evidenceLocalIso")): continue
        t = rule(r, S)
        if (t["dateKey"], t["slotId"]) == (val(r["dateKey"]), val(r["slotId"])): continue
        occ_rec = live.get((t["dateKey"], val(r["storeId"]), t["slotId"]))
        if occ_rec is not None and moved_from(occ_rec) == r["_id"]: occ, resume = None, True   # salinan kita sendiri: lanjutkan hapus
        else: occ, resume = (occ_rec["_id"] if occ_rec else None), False
        out.append({"resume": resume, "id": r["_id"], "store": val(r.get("storeName")), "crew": val(r.get("crewName")), "wall": t["wall"].isoformat(),
                    "localIso": val(r.get("evidenceLocalIso")), "old": f'{val(r["dateKey"])} {val(r["slotId"])} {val(r.get("status"))} {val(r.get("deviationMin"))}',
                    "new": f'{t["dateKey"]} {t["slotId"]} {t["status"]} {t["dev"]:+d}', "target": t, "occupiedBy": occ})
    return sorted(out, key=lambda p: p["wall"])


def new_id(date_key, store, slot):
    return re.sub(r"[^A-Za-z0-9_-]", "-", f"{date_key}_{store}_{slot}")


def move(old_id, S):
    code, old = curl("GET", f"{B}/filterRecords/{old_id}")
    if code != 200: sys.exit(f"[{old_id}] record lama tidak ada ({code}); mungkin sudah dipindah.")
    f = old["fields"]; t = rule(f, S)
    nid = new_id(t["dateKey"], val(f["storeId"]), t["slotId"])
    if nid == old_id: print(f"[{old_id}] sudah di slot yang benar, tidak ada yang diubah."); return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    with open(os.path.join(BACKUP_DIR, f"{old_id}.json"), "w") as fh: json.dump(old, fh)
    code, existing = curl("GET", f"{B}/filterRecords/{nid}")
    if code == 200:
        ef = existing.get("fields", {})
        same = val(ef.get("slotCorrection", {}).get("mapValue", {}).get("fields", {}).get("fromRecordId")) == old_id and ef.get("evidenceImage") == f.get("evidenceImage")
        if not same: sys.exit(f"[{old_id}] BATAL: slot tujuan {nid} sudah terisi record lain. Tidak ada yang diubah.")
        print(f"[{old_id}] record tujuan {nid} sudah dibuat sebelumnya (lanjutkan hapus record lama).")
    else:
        score = 1 if t["status"] == "ON TIME" else 0.5 if t["status"] in ("EARLY", "LATE") else 0
        nf = dict(f)
        nf.update({
            "recordId": {"stringValue": nid}, "dateKey": {"stringValue": t["dateKey"]}, "dayName": {"stringValue": t["dayName"]},
            "slotId": {"stringValue": t["slotId"]}, "slotLabel": {"stringValue": t["label"]}, "plannedTime": {"stringValue": t["planned"]},
            "deviationMin": {"integerValue": str(t["dev"])}, "status": {"stringValue": t["status"]},
            "complianceScore": {"integerValue": str(score)} if score in (0, 1) else {"doubleValue": score},
            "slotCorrection": {"mapValue": {"fields": {
                "fromRecordId": {"stringValue": old_id}, "fromDateKey": f["dateKey"], "fromSlotId": f["slotId"],
                "fromStatus": f.get("status", {"nullValue": None}), "fromDeviationMin": f.get("deviationMin", {"nullValue": None}),
                "reason": {"stringValue": "Foto sebelum 05:00 tercatat sebagai Filter 1 hari berikutnya (bug pemilihan slot). Dipindah ke slot hari operasional yang benar."},
                "correctedAt": {"timestampValue": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")},
            }}},
        })
        code, created = curl("POST", f"{B}/filterRecords?documentId={nid}", {"fields": nf})
        if code != 200: sys.exit(f"[{old_id}] gagal membuat {nid} ({code}: {json.dumps(created)[:200]}). Record lama tidak diubah.")
    code, chk = curl("GET", f"{B}/filterRecords/{nid}")
    if code != 200 or chk.get("fields", {}).get("evidenceImage") != f.get("evidenceImage"):
        sys.exit(f"[{old_id}] verifikasi {nid} gagal ({code}); record lama TIDAK dihapus. Jalankan ulang perintah yang sama untuk melanjutkan.")
    code, deleted = curl("DELETE", f"{B}/filterRecords/{old_id}?currentDocument.updateTime={old['updateTime']}")
    if code == 403: sys.exit(f"[{old_id}] {nid} sudah dibuat, tapi hapus record lama DITOLAK (403): butuh akses owner. Jalankan di Cloud Shell dengan FO_TOKEN (lihat bagian atas file).")
    if code != 200: sys.exit(f"[{old_id}] {nid} sudah ada, tapi hapus record lama gagal ({code}). Jalankan ulang perintah yang sama.")
    print(f"[{old_id}] OK → {nid} ({t['status']} {t['dev']:+d}); foto ikut pindah; cadangan {BACKUP_DIR}/{old_id}.json")


def archive(rid, reason):
    code, doc = curl("GET", f"{B}/filterRecords/{rid}?mask.fieldPaths=dedupArchived")
    if code != 200: sys.exit(f"[{rid}] tidak ada ({code})")
    body = {"fields": {"dedupArchived": {"booleanValue": True}, "archivedReason": {"stringValue": reason},
                       "archivedAt": {"timestampValue": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")}}}
    url = f"{B}/filterRecords/{rid}?updateMask.fieldPaths=dedupArchived&updateMask.fieldPaths=archivedReason&updateMask.fieldPaths=archivedAt&currentDocument.updateTime={doc['updateTime']}"
    code, res = curl("PATCH", url, body)
    if code != 200: sys.exit(f"[{rid}] arsip gagal ({code}: {json.dumps(res)[:200]})")
    print(f"[{rid}] diarsipkan: {reason}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "plan"
    S = settings()
    if cmd == "plan":
        p = plan(S)
        
        print(f"{len(p)} record beda slot menurut aturan baru (05:00 WIB, toleransi {S['tol']}):")
        for x in p: print(f"  {'SKIP' if x['occupiedBy'] else ('LANJUT' if x.get('resume') else 'PINDAH'):6} {x['store']:16} {x['old']:28} → {x['new']:28} foto(WIB) {x['wall'][5:16]}  {x['crew']}" + (f"  [terisi: {x['occupiedBy']}]" if x["occupiedBy"] else ""))
    elif cmd == "fix-all":
        # Duplikat yang disetujui owner untuk diarsipkan (bukan dipindah): input ganda dari HP berzona waktu salah.
        APPROVED_ARCHIVE = {"2026-10-04_TRIAL-BERINGIN_FILTER-2": "Input ganda dari HP berzona waktu UTC-12: foto 05/10 14:16 WIB tercatat 04/10 19:16. Input yang benar: 2026-10-05_TRIAL-BERINGIN_FILTER-2."}
        p = plan(S)
        moves = [x for x in p if not x["occupiedBy"]]
        print(f"{len(moves)} record akan dipindah, {len(p) - len(moves)} dilewati (slot tujuan terisi).")
        failed = 0
        for x in moves:
            try: move(x["id"], S)
            except SystemExit as e: failed += 1; print(e)
        for rid, reason in APPROVED_ARCHIVE.items():
            code, d = curl("GET", f"{B}/filterRecords/{rid}?mask.fieldPaths=dedupArchived")
            if code == 200 and val(d.get("fields", {}).get("dedupArchived")) is not True:
                try: archive(rid, reason)
                except SystemExit as e: failed += 1; print(e)
        left = [x for x in plan(S) if not x["occupiedBy"]]
        print(f"\nSELESAI: {len(moves) - failed} dipindah, {failed} gagal, {len(left)} masih perlu dipindah." + (" Jalankan ulang perintah yang sama." if left or failed else ""))
        for x in plan(S): print(f"  dibiarkan: {x['store']} {x['old']} (slot tujuan {x['occupiedBy']} sudah terisi)")
    elif cmd == "apply":
        for rid in sys.argv[2:]: move(rid, S)
    elif cmd == "archive":
        archive(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
