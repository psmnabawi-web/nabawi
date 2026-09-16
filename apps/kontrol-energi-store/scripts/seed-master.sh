#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ID="${1:-}"
if [ -z "$PROJECT_ID" ]; then
  echo "Project ID wajib diberikan ke seed-master.sh."
  exit 41
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MASTER_FILE="$APP_DIR/public/master-electric.json"

if [ ! -f "$MASTER_FILE" ]; then
  echo "File master tidak ditemukan: $MASTER_FILE"
  exit 42
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  if [ -n "${TMP_DIR:-}" ] && [ -d "$TMP_DIR" ]; then
    rm -rf -- "$TMP_DIR"
  fi
}
trap cleanup EXIT

validate_master() {
  jq -e '
    .locked == true
    and ((.masterVersion | type) == "string" and (.masterVersion | length) > 0)
    and (.stores | length) == 11
    and (.meters | length) == 11
    and ([.stores[] | select(.electricityModel == "prepaid")] | length) == 9
    and ([.stores[] | select(.electricityModel == "postpaid")] | length) == 2
    and ([.stores[].id] | unique | length) == 11
    and ([.stores[].code] | unique | length) == 11
    and ([.meters[].id] | unique | length) == 11
    and ([.meters[].serialNumber] | unique | length) == 11
    and all(.stores[];
      ((.id | type) == "string" and (.id | length) > 0 and (.id | contains("/") | not))
      and ((.code | type) == "string" and (.code | length) > 0)
      and ((.name | type) == "string" and (.name | length) > 0)
      and ((.area | type) == "string" and (.area | length) > 0)
      and ((.electricityModel | type) == "string" and (.electricityModel == "prepaid" or .electricityModel == "postpaid"))
      and ((.latitude | type) == "number" and .latitude >= -90 and .latitude <= 90)
      and ((.longitude | type) == "number" and .longitude >= -180 and .longitude <= 180)
      and ((.coordinateText | type) == "string" and (.coordinateText | length) > 0)
      and ((.tariffPerKwh | type) == "number" and .tariffPerKwh > 0)
    )
    and all(.meters[];
      ((.id | type) == "string" and (.id | length) > 0 and (.id | contains("/") | not))
      and ((.storeId | type) == "string" and (.storeId | length) > 0)
      and ((.serialNumber | type) == "string" and (.serialNumber | length) > 0)
      and ((.meterPower | type) == "number" and .meterPower > 0)
      and ((.multiplier | type) == "number" and .multiplier > 0)
    )
    and (. as $root | all(.meters[];
      .storeId as $storeId | any($root.stores[]; .id == $storeId)
    ))
  ' "$MASTER_FILE" >/dev/null
}

if ! validate_master; then
  echo "Validasi master gagal. Deploy dihentikan agar data tidak salah."
  exit 43
fi

ACCESS_TOKEN="$(gcloud auth print-access-token)"
if [ -z "$ACCESS_TOKEN" ]; then
  echo "Access token Google Cloud tidak tersedia."
  exit 46
fi

API_BASE="https://firestore.googleapis.com/v1/projects/$PROJECT_ID/databases/(default)/documents"
READINGS_FILE="$TMP_DIR/readings.ndjson"
STORES_FILE="$TMP_DIR/stores.ndjson"
METERS_FILE="$TMP_DIR/meters.ndjson"
TOKEN_PURCHASES_FILE="$TMP_DIR/token-purchases.ndjson"

fetch_collection_ndjson() {
  local collection_name="$1"
  local output_file="$2"
  shift 2
  local page_token=""
  local page_json=""
  local page_count=0
  local field=""
  local -a request_args

  : > "$output_file"
  while true; do
    request_args=(
      --fail-with-body -sS --get
      -H "Authorization: Bearer $ACCESS_TOKEN"
      -H "x-goog-user-project: $PROJECT_ID"
      --data-urlencode "pageSize=1000"
    )
    for field in "$@"; do
      request_args+=(--data-urlencode "mask.fieldPaths=$field")
    done
    if [ -n "$page_token" ]; then
      request_args+=(--data-urlencode "pageToken=$page_token")
    fi

    page_json="$(curl "${request_args[@]}" "$API_BASE/$collection_name")"
    if ! printf '%s' "$page_json" | jq -e 'type == "object"' >/dev/null; then
      echo "Respons Firestore tidak valid saat membaca $collection_name."
      exit 47
    fi
    printf '%s' "$page_json" | jq -c '.documents[]?' >> "$output_file"
    page_token="$(printf '%s' "$page_json" | jq -r '.nextPageToken // empty')"
    page_count=$((page_count + 1))
    if [ -z "$page_token" ]; then
      break
    fi
    if [ "$page_count" -gt 10000 ]; then
      echo "Pagination $collection_name melebihi batas aman."
      exit 48
    fi
  done
}

echo "Membaca master, riwayat, dan ledger token existing..."
fetch_collection_ndjson "readings" "$READINGS_FILE" meterId storeId readingDate capturedAt status electricityModel readingBasis readingKwh
fetch_collection_ndjson "stores" "$STORES_FILE" code active
fetch_collection_ndjson "meters" "$METERS_FILE" serialNumber storeId active
fetch_collection_ndjson "tokenPurchases" "$TOKEN_PURCHASES_FILE" meterId revision tokenKwhCenti purchaseAmountRp status

READING_METER_COUNTS="$(jq -s '
  map(select((.fields.meterId.stringValue? // "") != ""))
  | group_by(.fields.meterId.stringValue)
  | map({key: .[0].fields.meterId.stringValue, value: length})
  | from_entries
' "$READINGS_FILE")"

READING_STORE_COUNTS="$(jq -s '
  map(select((.fields.storeId.stringValue? // "") != ""))
  | group_by(.fields.storeId.stringValue)
  | map({key: .[0].fields.storeId.stringValue, value: length})
  | from_entries
' "$READINGS_FILE")"

EXISTING_METERS="$(jq -s '[.[] | {
  id: (.name | split("/") | last),
  serialNumber: (.fields.serialNumber.stringValue? // ""),
  serialNorm: ((.fields.serialNumber.stringValue? // "") | gsub("[^0-9]"; "")),
  storeId: (.fields.storeId.stringValue? // ""),
  active: (.fields.active.booleanValue? // true)
}]' "$METERS_FILE")"

EXISTING_STORES="$(jq -s '[.[] | {
  id: (.name | split("/") | last),
  code: (.fields.code.stringValue? // ""),
  codeNorm: ((.fields.code.stringValue? // "") | gsub("[^0-9]"; "")),
  active: (.fields.active.booleanValue? // true)
}]' "$STORES_FILE")"

METER_ID_MAP='{}'
PREFERRED_STORE_MAP='{}'

echo "Mencocokkan ID meter berdasarkan nomor seri..."
while IFS= read -r row; do
  desired_id="$(printf '%s' "$row" | jq -r '.id')"
  desired_store_id="$(printf '%s' "$row" | jq -r '.storeId')"
  serial_number="$(printf '%s' "$row" | jq -r '.serialNumber')"
  chosen_id="$(printf '%s' "$EXISTING_METERS" | jq -r \
    --arg serial "$serial_number" \
    --argjson counts "$READING_METER_COUNTS" '
      ($serial | gsub("[^0-9]"; "")) as $serialNorm
      | map(select(.serialNorm == $serialNorm))
      | map(. + {readingCount: ($counts[.id] // 0)})
      | sort_by([(-.readingCount), (if .active then 0 else 1 end), .id])
      | .[0].id // empty
    ')"

  if [ -z "$chosen_id" ]; then
    chosen_id="$desired_id"
    echo "  + $serial_number memakai ID baru $chosen_id"
  else
    reading_count="$(printf '%s' "$READING_METER_COUNTS" | jq -r --arg id "$chosen_id" '.[$id] // 0')"
    echo "  = $serial_number memakai ID existing $chosen_id ($reading_count reading)"
  fi

  METER_ID_MAP="$(printf '%s' "$METER_ID_MAP" | jq -c \
    --arg source "$desired_id" --arg target "$chosen_id" '. + {($source): $target}')"

  live_store_id="$(printf '%s' "$EXISTING_METERS" | jq -r \
    --arg id "$chosen_id" 'map(select(.id == $id)) | .[0].storeId // empty')"
  if [ -n "$live_store_id" ]; then
    PREFERRED_STORE_MAP="$(printf '%s' "$PREFERRED_STORE_MAP" | jq -c \
      --arg source "$desired_store_id" --arg target "$live_store_id" \
      '. + {($source): $target}')"
  fi
done < <(jq -c '.meters[]' "$MASTER_FILE")

STORE_ID_MAP='{}'

echo "Mencocokkan ID store berdasarkan relasi meter dan kode store..."
while IFS= read -r row; do
  desired_id="$(printf '%s' "$row" | jq -r '.id')"
  store_code="$(printf '%s' "$row" | jq -r '.code')"
  preferred_id="$(printf '%s' "$PREFERRED_STORE_MAP" | jq -r --arg id "$desired_id" '.[$id] // empty')"
  chosen_id=""

  if [ -n "$preferred_id" ] && printf '%s' "$EXISTING_STORES" | jq -e \
    --arg id "$preferred_id" 'any(.[]; .id == $id)' >/dev/null; then
    chosen_id="$preferred_id"
    live_code="$(printf '%s' "$EXISTING_STORES" | jq -r \
      --arg id "$preferred_id" 'map(select(.id == $id)) | .[0].code // empty')"
    if [ "$(printf '%s' "$live_code" | tr -cd '0-9')" != "$(printf '%s' "$store_code" | tr -cd '0-9')" ]; then
      echo "  ! $preferred_id mengikuti relasi nomor seri; kode lama '$live_code' ditimpa '$store_code'"
    fi
  fi

  if [ -z "$chosen_id" ]; then
    chosen_id="$(printf '%s' "$EXISTING_STORES" | jq -r \
      --arg code "$store_code" \
      --argjson counts "$READING_STORE_COUNTS" '
        ($code | gsub("[^0-9]"; "")) as $codeNorm
        | map(select(.codeNorm == $codeNorm))
        | map(. + {readingCount: ($counts[.id] // 0)})
        | sort_by([(-.readingCount), (if .active then 0 else 1 end), .id])
        | .[0].id // empty
      ')"
  fi

  if [ -z "$chosen_id" ]; then
    chosen_id="$desired_id"
    echo "  + $store_code memakai ID baru $chosen_id"
  else
    reading_count="$(printf '%s' "$READING_STORE_COUNTS" | jq -r --arg id "$chosen_id" '.[$id] // 0')"
    echo "  = $store_code memakai ID existing $chosen_id ($reading_count reading)"
  fi

  STORE_ID_MAP="$(printf '%s' "$STORE_ID_MAP" | jq -c \
    --arg source "$desired_id" --arg target "$chosen_id" '. + {($source): $target}')"
done < <(jq -c '.stores[]' "$MASTER_FILE")

ADAPTED_MASTER="$TMP_DIR/master-electric-adapted.json"
jq --argjson storeMap "$STORE_ID_MAP" --argjson meterMap "$METER_ID_MAP" '
  .stores |= map(.id = ($storeMap[.id] // .id))
  | .meters |= map(
      .storeId = ($storeMap[.storeId] // .storeId)
      | .id = ($meterMap[.id] // .id)
    )
' "$MASTER_FILE" > "$ADAPTED_MASTER"
mv "$ADAPTED_MASTER" "$MASTER_FILE"

if ! validate_master; then
  echo "Adaptasi ID existing menghasilkan master tidak valid atau ID ganda."
  exit 49
fi

MASTER_STORE_IDS="$(jq -c '[.stores[].id]' "$MASTER_FILE")"
MASTER_METER_IDS="$(jq -c '[.meters[].id]' "$MASTER_FILE")"
LEGACY_IDS="$(jq -r --argjson valid "$MASTER_METER_IDS" '
  (.fields.meterId.stringValue? // "") as $id
  | select($id != "" and (($valid | index($id)) == null))
  | $id
' "$READINGS_FILE" | sort -u | paste -sd ', ' -)"

if [ -n "$LEGACY_IDS" ]; then
  echo "Ditemukan reading yang nomor seri meternya tidak dapat dicocokkan ke master: $LEGACY_IDS"
  echo "Deploy dihentikan agar baseline tidak terputus atau berpindah ke meter yang salah."
  exit 44
fi

MASTER_VERSION="$(jq -r '.masterVersion' "$MASTER_FILE")"
MASTER_HASH="$(sha256sum "$MASTER_FILE" | awk '{print $1}')"
SYNCED_AT="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

STORE_MASK="updateMask.fieldPaths=code&updateMask.fieldPaths=name&updateMask.fieldPaths=area&updateMask.fieldPaths=electricityModel&updateMask.fieldPaths=latitude&updateMask.fieldPaths=longitude&updateMask.fieldPaths=coordinateText&updateMask.fieldPaths=tariffPerKwh&updateMask.fieldPaths=active&updateMask.fieldPaths=locked&updateMask.fieldPaths=managedBy&updateMask.fieldPaths=masterVersion&updateMask.fieldPaths=masterHash&updateMask.fieldPaths=syncedAt"
METER_MASK="updateMask.fieldPaths=storeId&updateMask.fieldPaths=name&updateMask.fieldPaths=serialNumber&updateMask.fieldPaths=meterPower&updateMask.fieldPaths=displayDigits&updateMask.fieldPaths=decimalPlaces&updateMask.fieldPaths=multiplier&updateMask.fieldPaths=maxDailyKwh&updateMask.fieldPaths=active&updateMask.fieldPaths=locked&updateMask.fieldPaths=managedBy&updateMask.fieldPaths=masterVersion&updateMask.fieldPaths=masterHash&updateMask.fieldPaths=syncedAt"

echo "Menyinkronkan 11 store master..."
while IFS= read -r row; do
  STORE_ID="$(printf '%s' "$row" | jq -r '.id')"
  BODY="$(jq -n \
    --argjson row "$row" \
    --arg version "$MASTER_VERSION" \
    --arg hash "$MASTER_HASH" \
    --arg syncedAt "$SYNCED_AT" \
    '{fields:{
      code:{stringValue:$row.code},
      name:{stringValue:$row.name},
      area:{stringValue:$row.area},
      electricityModel:{stringValue:$row.electricityModel},
      latitude:{doubleValue:$row.latitude},
      longitude:{doubleValue:$row.longitude},
      coordinateText:{stringValue:$row.coordinateText},
      tariffPerKwh:{doubleValue:$row.tariffPerKwh},
      active:{booleanValue:true},
      locked:{booleanValue:true},
      managedBy:{stringValue:"master-electric"},
      masterVersion:{stringValue:$version},
      masterHash:{stringValue:$hash},
      syncedAt:{timestampValue:$syncedAt}
    }}')"
  curl --fail-with-body -sS -X PATCH \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "x-goog-user-project: $PROJECT_ID" \
    -H "Content-Type: application/json" \
    --data "$BODY" \
    "$API_BASE/stores/$STORE_ID?$STORE_MASK" >/dev/null
  echo "  ✓ $STORE_ID"
done < <(jq -c '.stores[]' "$MASTER_FILE")

echo "Menyinkronkan 11 meter master..."
while IFS= read -r row; do
  METER_ID="$(printf '%s' "$row" | jq -r '.id')"
  BODY="$(jq -n \
    --argjson row "$row" \
    --arg version "$MASTER_VERSION" \
    --arg hash "$MASTER_HASH" \
    --arg syncedAt "$SYNCED_AT" \
    '{fields:{
      storeId:{stringValue:$row.storeId},
      name:{stringValue:$row.name},
      serialNumber:{stringValue:$row.serialNumber},
      meterPower:{integerValue:($row.meterPower|tostring)},
      displayDigits:{nullValue:null},
      decimalPlaces:{nullValue:null},
      multiplier:{doubleValue:$row.multiplier},
      maxDailyKwh:{nullValue:null},
      active:{booleanValue:true},
      locked:{booleanValue:true},
      managedBy:{stringValue:"master-electric"},
      masterVersion:{stringValue:$version},
      masterHash:{stringValue:$hash},
      syncedAt:{timestampValue:$syncedAt}
    }}')"
  curl --fail-with-body -sS -X PATCH \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "x-goog-user-project: $PROJECT_ID" \
    -H "Content-Type: application/json" \
    --data "$BODY" \
    "$API_BASE/meters/$METER_ID?$METER_MASK" >/dev/null
  echo "  ✓ $METER_ID"
done < <(jq -c '.meters[]' "$MASTER_FILE")

REGISTRY_BODY="$(jq -n \
  --arg version "$MASTER_VERSION" \
  --arg hash "$MASTER_HASH" \
  --arg syncedAt "$SYNCED_AT" \
  --argjson storeIds "$MASTER_STORE_IDS" \
  --argjson meterIds "$MASTER_METER_IDS" \
  '{fields:{
    source:{stringValue:"Master Electric.xlsx"},
    masterVersion:{stringValue:$version},
    masterHash:{stringValue:$hash},
    storeCount:{integerValue:"11"},
    meterCount:{integerValue:"11"},
    prepaidCount:{integerValue:"9"},
    postpaidCount:{integerValue:"2"},
    storeIds:{arrayValue:{values:[$storeIds[] | {stringValue:.}]}},
    meterIds:{arrayValue:{values:[$meterIds[] | {stringValue:.}]}},
    locked:{booleanValue:true},
    syncedAt:{timestampValue:$syncedAt}
  }}')"
curl --fail-with-body -sS -X PATCH \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "x-goog-user-project: $PROJECT_ID" \
  -H "Content-Type: application/json" \
  --data "$REGISTRY_BODY" \
  "$API_BASE/masterRegistry/electric" >/dev/null

echo "Menyiapkan state token 9 meter prabayar tanpa menimpa saldo existing..."
while IFS= read -r pair; do
  TOKEN_STORE="$(printf '%s' "$pair" | jq -c '.store')"
  TOKEN_METER="$(printf '%s' "$pair" | jq -c '.meter')"
  TOKEN_STORE_ID="$(printf '%s' "$TOKEN_STORE" | jq -r '.id')"
  TOKEN_STORE_CODE="$(printf '%s' "$TOKEN_STORE" | jq -r '.code')"
  TOKEN_STORE_NAME="$(printf '%s' "$TOKEN_STORE" | jq -r '.name')"
  TOKEN_METER_ID="$(printf '%s' "$TOKEN_METER" | jq -r '.id')"
  TOKEN_METER_SERIAL="$(printf '%s' "$TOKEN_METER" | jq -r '.serialNumber')"
  TOKEN_LEDGER="$(jq -s --arg meterId "$TOKEN_METER_ID" '
    [ .[]
      | select((.fields.meterId.stringValue? // "") == $meterId)
      | {
          id:(.name | split("/") | last),
          revision:((.fields.revision.integerValue? // "-1") | tonumber),
          tokenKwhCenti:((.fields.tokenKwhCenti.integerValue? // "-1") | tonumber),
          purchaseAmountRp:((.fields.purchaseAmountRp.integerValue? // "-1") | tonumber),
          status:(.fields.status.stringValue? // "")
        }
    ] | sort_by(.revision)
  ' "$TOKEN_PURCHASES_FILE")"
  TOKEN_EXISTING_PURCHASES="$(printf '%s' "$TOKEN_LEDGER" | jq 'length')"

  TOKEN_LAST_READING="$(jq -sc --arg meterId "$TOKEN_METER_ID" '
    map(select(
      (.fields.meterId.stringValue? // "") == $meterId
      and (.fields.status.stringValue? // "") == "valid"
      and (.fields.electricityModel.stringValue? // "") == "prepaid"
      and (.fields.readingBasis.stringValue? // "") == "remaining_balance"
      and ((.fields.readingDate.stringValue? // "") | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$"))
      and ((.fields.capturedAt.stringValue? // "")
        | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?Z$"))
      and (.fields.readingKwh | type) == "object"
    ))
    | sort_by([
        (.fields.readingDate.stringValue? // ""),
        (.fields.capturedAt.stringValue? // "")
      ])
    | last // empty
  ' "$READINGS_FILE")"
  TOKEN_LAST_ID=""
  TOKEN_LAST_DATE=""
  TOKEN_LAST_CAPTURED=""
  TOKEN_LAST_KWH_CENTI="null"
  if [ -n "$TOKEN_LAST_READING" ]; then
    TOKEN_LAST_ID="$(printf '%s' "$TOKEN_LAST_READING" | jq -r '.name | split("/") | last')"
    TOKEN_LAST_DATE="$(printf '%s' "$TOKEN_LAST_READING" | jq -r '.fields.readingDate.stringValue')"
    TOKEN_LAST_CAPTURED="$(printf '%s' "$TOKEN_LAST_READING" | jq -r '.fields.capturedAt.stringValue')"
    TOKEN_LAST_KWH_CENTI="$(printf '%s' "$TOKEN_LAST_READING" | jq -r '
      (((.fields.readingKwh.doubleValue // .fields.readingKwh.integerValue) | tonumber) * 100 | round)
    ')"
  fi

  TOKEN_STATE_FILE="$TMP_DIR/token-state-$TOKEN_METER_ID.json"
  TOKEN_STATE_CODE="$(curl -sS -o "$TOKEN_STATE_FILE" -w '%{http_code}' \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "x-goog-user-project: $PROJECT_ID" \
    "$API_BASE/tokenStates/$TOKEN_METER_ID")"

  if [ "$TOKEN_STATE_CODE" = "200" ]; then
    if ! jq -e \
      --arg meterId "$TOKEN_METER_ID" \
      --arg storeId "$TOKEN_STORE_ID" \
      --arg storeCode "$TOKEN_STORE_CODE" \
      --arg storeName "$TOKEN_STORE_NAME" \
      --arg meterSerial "$TOKEN_METER_SERIAL" \
      --arg lastId "$TOKEN_LAST_ID" \
      --arg lastDate "$TOKEN_LAST_DATE" \
      --arg lastCaptured "$TOKEN_LAST_CAPTURED" \
      --argjson lastKwhCenti "$TOKEN_LAST_KWH_CENTI" \
      --argjson ledger "$TOKEN_LEDGER" \
      --arg version "$MASTER_VERSION" '
        def iv($field): ($field.integerValue | tonumber);
        def safe_nonnegative($field):
          ($field | has("integerValue"))
          and (iv($field) >= 0)
          and (iv($field) <= 9007199254740991);
        def valid_utc_time:
          type == "string"
          and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?Z$");
        .fields as $f
        | (($f | keys | sort) == ([
            "meterId", "storeId", "storeCode", "storeName", "meterSerial",
            "electricityModel", "revision", "pendingFromRevision",
            "pendingPurchaseCount", "pendingTokenKwhCenti", "pendingAmountRp",
            "lastPurchaseId", "lastConsumedRevision", "lastAcceptedReadingId",
            "lastAcceptedReadingDate", "lastAcceptedReadingKwhCenti",
            "lastAcceptedCapturedAt", "lastEventType", "lastEventId",
            "updatedAt", "masterVersion"
          ] | sort))
        and $f.meterId.stringValue == $meterId
        and $f.storeId.stringValue == $storeId
        and $f.storeCode.stringValue == $storeCode
        and $f.storeName.stringValue == $storeName
        and $f.meterSerial.stringValue == $meterSerial
        and $f.electricityModel.stringValue == "prepaid"
        and $f.masterVersion.stringValue == $version
        and safe_nonnegative($f.revision)
        and safe_nonnegative($f.pendingPurchaseCount)
        and safe_nonnegative($f.pendingTokenKwhCenti)
        and safe_nonnegative($f.pendingAmountRp)
        and safe_nonnegative($f.lastConsumedRevision)
        and (iv($f.lastConsumedRevision) + iv($f.pendingPurchaseCount) == iv($f.revision))
        and ($ledger | length) == iv($f.revision)
        and ($ledger | to_entries | all(
          .value.revision == (.key + 1)
          and .value.tokenKwhCenti > 0
          and .value.tokenKwhCenti <= 99999999999999
          and .value.purchaseAmountRp > 0
          and .value.purchaseAmountRp <= 999999999
          and .value.status == "recorded"
        ))
        and (iv($f.revision) == 0
          or $f.lastPurchaseId.stringValue == ($ledger | last | .id))
        and ([ $ledger[] | select(.revision > iv($f.lastConsumedRevision)) ] | length)
          == iv($f.pendingPurchaseCount)
        and ([ $ledger[] | select(.revision > iv($f.lastConsumedRevision)) | .tokenKwhCenti ] | add // 0)
          == iv($f.pendingTokenKwhCenti)
        and ([ $ledger[] | select(.revision > iv($f.lastConsumedRevision)) | .purchaseAmountRp ] | add // 0)
          == iv($f.pendingAmountRp)
        and (
          (iv($f.pendingPurchaseCount) == 0
            and ($f.pendingFromRevision | has("nullValue"))
            and iv($f.pendingTokenKwhCenti) == 0
            and iv($f.pendingAmountRp) == 0
            and iv($f.lastConsumedRevision) == iv($f.revision))
          or
          (iv($f.pendingPurchaseCount) > 0
            and ($f.pendingFromRevision | has("integerValue"))
            and iv($f.pendingFromRevision) == iv($f.lastConsumedRevision) + 1
            and iv($f.pendingTokenKwhCenti) > 0
            and iv($f.pendingAmountRp) > 0)
        )
        and (
          (iv($f.revision) == 0 and $f.lastPurchaseId.stringValue == "")
          or (iv($f.revision) > 0 and ($f.lastPurchaseId.stringValue | length) > 0)
        )
        and (
          ($f.lastAcceptedReadingId.stringValue == ""
            and $f.lastAcceptedReadingDate.stringValue == ""
            and ($f.lastAcceptedReadingKwhCenti | has("nullValue"))
            and ($f.lastAcceptedCapturedAt | has("nullValue")))
          or
          (($f.lastAcceptedReadingId.stringValue | length) > 0
            and ($f.lastAcceptedReadingDate.stringValue | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$"))
            and ($f.lastAcceptedReadingKwhCenti | has("integerValue"))
            and iv($f.lastAcceptedReadingKwhCenti) >= 0
            and iv($f.lastAcceptedReadingKwhCenti) <= 99999999999999
            and ($f.lastAcceptedCapturedAt.stringValue | valid_utc_time))
        )
        and $f.lastAcceptedReadingId.stringValue == $lastId
        and $f.lastAcceptedReadingDate.stringValue == $lastDate
        and (if $lastKwhCenti == null
          then ($f.lastAcceptedReadingKwhCenti | has("nullValue"))
          else iv($f.lastAcceptedReadingKwhCenti) == $lastKwhCenti end)
        and (if $lastCaptured == ""
          then ($f.lastAcceptedCapturedAt | has("nullValue"))
          else $f.lastAcceptedCapturedAt.stringValue == $lastCaptured end)
        and ($f.lastEventType.stringValue == "seed"
          or $f.lastEventType.stringValue == "purchase"
          or $f.lastEventType.stringValue == "reading")
        and ($f.lastEventId.stringValue | length) > 0
        and ($f.updatedAt.timestampValue | valid_utc_time)
      ' "$TOKEN_STATE_FILE" >/dev/null; then
      echo "State token existing tidak sesuai master: $TOKEN_METER_ID"
      exit 51
    fi
    echo "  = $TOKEN_METER_ID dipertahankan"
    continue
  fi

  if [ "$TOKEN_STATE_CODE" != "404" ]; then
    echo "Gagal membaca state token $TOKEN_METER_ID (HTTP $TOKEN_STATE_CODE)."
    cat "$TOKEN_STATE_FILE"
    exit 52
  fi

  if [ "$TOKEN_EXISTING_PURCHASES" -ne 0 ]; then
    echo "Ditemukan $TOKEN_EXISTING_PURCHASES pembelian token tanpa state pada $TOKEN_METER_ID."
    echo "Deploy dihentikan agar saldo token tidak diinisialisasi menjadi nol."
    exit 53
  fi

  TOKEN_STATE_BODY="$(jq -n \
    --arg meterId "$TOKEN_METER_ID" \
    --arg storeId "$TOKEN_STORE_ID" \
    --arg storeCode "$TOKEN_STORE_CODE" \
    --arg storeName "$TOKEN_STORE_NAME" \
    --arg meterSerial "$TOKEN_METER_SERIAL" \
    --arg lastId "$TOKEN_LAST_ID" \
    --arg lastDate "$TOKEN_LAST_DATE" \
    --arg lastCaptured "$TOKEN_LAST_CAPTURED" \
    --argjson lastKwhCenti "$TOKEN_LAST_KWH_CENTI" \
    --arg version "$MASTER_VERSION" \
    --arg syncedAt "$SYNCED_AT" '
      {fields:{
        meterId:{stringValue:$meterId},
        storeId:{stringValue:$storeId},
        storeCode:{stringValue:$storeCode},
        storeName:{stringValue:$storeName},
        meterSerial:{stringValue:$meterSerial},
        electricityModel:{stringValue:"prepaid"},
        revision:{integerValue:"0"},
        pendingFromRevision:{nullValue:null},
        pendingPurchaseCount:{integerValue:"0"},
        pendingTokenKwhCenti:{integerValue:"0"},
        pendingAmountRp:{integerValue:"0"},
        lastPurchaseId:{stringValue:""},
        lastConsumedRevision:{integerValue:"0"},
        lastAcceptedReadingId:{stringValue:$lastId},
        lastAcceptedReadingDate:{stringValue:$lastDate},
        lastAcceptedReadingKwhCenti:(if $lastKwhCenti == null then {nullValue:null} else {integerValue:($lastKwhCenti|tostring)} end),
        lastAcceptedCapturedAt:(if $lastCaptured == "" then {nullValue:null} else {stringValue:$lastCaptured} end),
        lastEventType:{stringValue:"seed"},
        lastEventId:{stringValue:"seed-v1.1.4"},
        updatedAt:{timestampValue:$syncedAt},
        masterVersion:{stringValue:$version}
      }}
    ')"
  TOKEN_CREATE_FILE="$TMP_DIR/token-state-create-$TOKEN_METER_ID.json"
  TOKEN_CREATE_CODE="$(curl -sS -o "$TOKEN_CREATE_FILE" -w '%{http_code}' -X PATCH \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "x-goog-user-project: $PROJECT_ID" \
    -H "Content-Type: application/json" \
    --data "$TOKEN_STATE_BODY" \
    "$API_BASE/tokenStates/$TOKEN_METER_ID?currentDocument.exists=false")"
  if [ "$TOKEN_CREATE_CODE" != "200" ]; then
    echo "Gagal membuat state token $TOKEN_METER_ID (HTTP $TOKEN_CREATE_CODE)."
    cat "$TOKEN_CREATE_FILE"
    exit 54
  fi
  if [ -n "$TOKEN_LAST_ID" ]; then
    echo "  + $TOKEN_METER_ID dibuat dari baseline $TOKEN_LAST_ID"
  else
    echo "  + $TOKEN_METER_ID dibuat kosong; input berikutnya menjadi baseline"
  fi
done < <(jq -c '
  . as $root
  | .stores[]
  | select(.electricityModel == "prepaid") as $store
  | $root.meters[]
  | select(.storeId == $store.id)
  | {store:$store, meter:.}
' "$MASTER_FILE")

echo "Memverifikasi isi dan hash master terkunci..."
VALID_STORES=0
while IFS= read -r row; do
  store_id="$(printf '%s' "$row" | jq -r '.id')"
  DOC="$(curl --fail-with-body -sS \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "x-goog-user-project: $PROJECT_ID" \
    "$API_BASE/stores/$store_id")"
  if printf '%s' "$DOC" | jq -e \
    --argjson row "$row" --arg version "$MASTER_VERSION" --arg hash "$MASTER_HASH" '
      def close_to($actual; $expected; $epsilon):
        (((($actual | tonumber) - $expected) | fabs) <= $epsilon);
      .fields.code.stringValue == $row.code
      and .fields.name.stringValue == $row.name
      and .fields.area.stringValue == $row.area
      and .fields.electricityModel.stringValue == $row.electricityModel
      and close_to((.fields.latitude.doubleValue // .fields.latitude.integerValue); $row.latitude; 0.000000000001)
      and close_to((.fields.longitude.doubleValue // .fields.longitude.integerValue); $row.longitude; 0.000000000001)
      and .fields.coordinateText.stringValue == $row.coordinateText
      and close_to((.fields.tariffPerKwh.doubleValue // .fields.tariffPerKwh.integerValue); $row.tariffPerKwh; 0.000000001)
      and .fields.locked.booleanValue == true
      and .fields.active.booleanValue == true
      and .fields.managedBy.stringValue == "master-electric"
      and .fields.masterVersion.stringValue == $version
      and .fields.masterHash.stringValue == $hash
    ' >/dev/null; then
    VALID_STORES=$((VALID_STORES + 1))
  else
    echo "Verifikasi store gagal: $store_id"
    printf '%s' "$DOC" | jq -r --argjson row "$row" '
      "  REST   lat=\(.fields.latitude.doubleValue // .fields.latitude.integerValue // "missing") lng=\(.fields.longitude.doubleValue // .fields.longitude.integerValue // "missing") tarif=\(.fields.tariffPerKwh.doubleValue // .fields.tariffPerKwh.integerValue // "missing")\n  MASTER lat=\($row.latitude) lng=\($row.longitude) tarif=\($row.tariffPerKwh)"
    ' 2>/dev/null || true
  fi
done < <(jq -c '.stores[]' "$MASTER_FILE")

VALID_METERS=0
while IFS= read -r row; do
  meter_id="$(printf '%s' "$row" | jq -r '.id')"
  DOC="$(curl --fail-with-body -sS \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "x-goog-user-project: $PROJECT_ID" \
    "$API_BASE/meters/$meter_id")"
  if printf '%s' "$DOC" | jq -e \
    --argjson row "$row" --arg version "$MASTER_VERSION" --arg hash "$MASTER_HASH" '
      .fields.storeId.stringValue == $row.storeId
      and .fields.name.stringValue == $row.name
      and .fields.serialNumber.stringValue == $row.serialNumber
      and ((.fields.meterPower.integerValue // .fields.meterPower.doubleValue) | tonumber) == $row.meterPower
      and ((.fields.multiplier.doubleValue // .fields.multiplier.integerValue) | tonumber) == $row.multiplier
      and (.fields | has("displayDigits")) and (.fields.displayDigits | has("nullValue"))
      and (.fields | has("decimalPlaces")) and (.fields.decimalPlaces | has("nullValue"))
      and (.fields | has("maxDailyKwh")) and (.fields.maxDailyKwh | has("nullValue"))
      and .fields.locked.booleanValue == true
      and .fields.active.booleanValue == true
      and .fields.managedBy.stringValue == "master-electric"
      and .fields.masterVersion.stringValue == $version
      and .fields.masterHash.stringValue == $hash
    ' >/dev/null; then
    VALID_METERS=$((VALID_METERS + 1))
  else
    echo "Verifikasi meter gagal: $meter_id"
  fi
done < <(jq -c '.meters[]' "$MASTER_FILE")

REGISTRY_DOC="$(curl --fail-with-body -sS \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "x-goog-user-project: $PROJECT_ID" \
  "$API_BASE/masterRegistry/electric")"

if ! printf '%s' "$REGISTRY_DOC" | jq -e \
  --arg version "$MASTER_VERSION" --arg hash "$MASTER_HASH" \
  --argjson storeIds "$MASTER_STORE_IDS" --argjson meterIds "$MASTER_METER_IDS" '
    .fields.source.stringValue == "Master Electric.xlsx"
    and .fields.masterVersion.stringValue == $version
    and .fields.masterHash.stringValue == $hash
    and (.fields.storeCount.integerValue | tonumber) == 11
    and (.fields.meterCount.integerValue | tonumber) == 11
    and (.fields.prepaidCount.integerValue | tonumber) == 9
    and (.fields.postpaidCount.integerValue | tonumber) == 2
    and ([.fields.storeIds.arrayValue.values[].stringValue] | sort) == ($storeIds | sort)
    and ([.fields.meterIds.arrayValue.values[].stringValue] | sort) == ($meterIds | sort)
    and .fields.locked.booleanValue == true
  ' >/dev/null; then
  echo "Verifikasi registry master gagal."
  exit 50
fi

if [ "$VALID_STORES" -ne 11 ] || [ "$VALID_METERS" -ne 11 ]; then
  echo "Verifikasi gagal: $VALID_STORES/11 store dan $VALID_METERS/11 meter valid."
  exit 45
fi

echo "Master terkunci tervalidasi: 11 store, 11 meter, 9 prabayar, dan 2 pascabayar."
echo "Master version: $MASTER_VERSION"
echo "Master hash: $MASTER_HASH"
