#!/usr/bin/env python3
"""東京ディズニーランド・ディズニーシーの待ち時間を記録するスクリプト。

themeparks.wiki の Tokyo Disney Resort ライブデータAPIを1回呼び出し、
その時点の全アトラクションの状態を JST の日付ごとの JSON ファイル
(data/YYYY-MM-DD.json) に1レコードとして追記する。

GitHub Actions から15分おきに実行される想定。
API取得に失敗した場合は、その回の記録をスキップしてログのみ残す
(リトライ・通知はしない)。
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo

import requests

# Tokyo Disney Resort (destination) の themeparks.wiki エンティティID。
# このIDに対する /live 呼び出し1回で、TDL・TDS両パークの全アトラクションの
# ライブデータがまとめて返ってくる。
DESTINATION_ID = "faff60df-c766-4470-8adb-dee78e813f42"
API_URL = f"https://api.themeparks.wiki/v1/entity/{DESTINATION_ID}/live"

# parkId -> パーク略称のマッピング
PARK_NAMES = {
    "3cc919f1-d16d-43e0-8c3f-1dd269bd1a42": "TDL",  # Tokyo Disneyland
    "67b290d5-3478-4f23-b601-2f8fb71ba803": "TDS",  # Tokyo DisneySea
}

JST = ZoneInfo("Asia/Tokyo")
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
REQUEST_TIMEOUT_SECONDS = 30


def fetch_live_data() -> dict[str, Any]:
    response = requests.get(API_URL, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()


def extract_queue_info(queue: dict[str, Any]) -> dict[str, Any]:
    """queueオブジェクトから記録したい値を取り出す。

    - STANDBY: 通常の待ち時間(分)
    - SINGLE_RIDER: シングルライダーの待ち時間(分)
    - PAID_RETURN_TIME / RETURN_TIME: 有料・無料のプライオリティパス系。
      APIは「待ち時間(分)」ではなく利用可否(state)や入場可能時間帯
      (returnStart/returnEnd)を返すため、そのまま記録する。
    """
    standby = queue.get("STANDBY", {}).get("waitTime")
    single_rider = queue.get("SINGLE_RIDER", {}).get("waitTime")

    priority_pass: Optional[dict[str, Any]] = None
    for key in ("PAID_RETURN_TIME", "RETURN_TIME"):
        entry = queue.get(key)
        if entry:
            priority_pass = {
                "type": key,
                "state": entry.get("state"),
                "returnStart": entry.get("returnStart"),
                "returnEnd": entry.get("returnEnd"),
            }
            break

    return {
        "standbyWaitTime": standby,
        "singleRiderWaitTime": single_rider,
        "priorityPass": priority_pass,
    }


def build_record(live_data: dict[str, Any]) -> Optional[dict[str, Any]]:
    attractions = []
    for entry in live_data.get("liveData", []):
        if entry.get("entityType") != "ATTRACTION":
            continue
        park = PARK_NAMES.get(entry.get("parkId"))
        if park is None:
            continue  # TDL・TDS以外(対象外)のエンティティはスキップ

        record = {
            "id": entry.get("id"),
            "name": entry.get("name"),
            "park": park,
            "status": entry.get("status"),
        }
        record.update(extract_queue_info(entry.get("queue", {})))
        attractions.append(record)

    if not attractions:
        return None

    now_utc = datetime.now(timezone.utc)
    return {
        "timestamp": now_utc.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "attractions": attractions,
    }


def append_record(record: dict[str, Any]) -> Path:
    # ファイルの日付区切りはJST基準(パークの営業日と一致させるため)
    now_jst = datetime.now(JST)
    date_str = now_jst.strftime("%Y-%m-%d")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    file_path = DATA_DIR / f"{date_str}.json"

    if file_path.exists():
        with file_path.open("r", encoding="utf-8") as f:
            day_data = json.load(f)
    else:
        day_data = {"date": date_str, "records": []}

    day_data["records"].append(record)

    with file_path.open("w", encoding="utf-8") as f:
        json.dump(day_data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    return file_path


def main() -> int:
    try:
        live_data = fetch_live_data()
    except requests.RequestException as exc:
        print(f"API取得に失敗したためスキップします: {exc}", file=sys.stderr)
        return 0

    record = build_record(live_data)
    if record is None:
        print(
            "有効なアトラクションデータが取得できなかったためスキップします",
            file=sys.stderr,
        )
        return 0

    file_path = append_record(record)
    print(f"{file_path} に {len(record['attractions'])}件のアトラクションデータを記録しました")
    return 0


if __name__ == "__main__":
    sys.exit(main())
