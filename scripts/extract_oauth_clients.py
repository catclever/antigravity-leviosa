#!/usr/bin/env python3
"""
Antigravity Language Server OAuth Credentials Extractor
------------------------------------------------------
This tool dynamically scans the local Antigravity binary on your machine
to extract and pair the Google OAuth Client IDs and Client Secrets,
saving them to `~/.gemini/.accounts/oauth_clients.json`.

Usage:
    python3 scripts/extract_oauth_clients.py
"""

import os
import re
import sys
import json
import argparse
import subprocess

DEFAULT_BINARY_PATHS = [
    "/Applications/Antigravity.app/Contents/Resources/bin/language_server",
    os.path.expanduser("~/Applications/Antigravity.app/Contents/Resources/bin/language_server"),
]

DEFAULT_GLOBAL_OUTPUT = os.path.expanduser("~/.gemini/.accounts/oauth_clients.json")


def find_running_binary():
    """Attempt to locate language_server from active processes."""
    try:
        out = subprocess.check_output(["ps", "-eo", "command"], stderr=subprocess.DEVNULL).decode("utf-8", errors="ignore")
        for line in out.splitlines():
            line = line.strip()
            if "language_server" in line and not line.startswith("ps "):
                parts = line.split()
                if parts and os.path.exists(parts[0]):
                    return parts[0]
    except Exception:
        pass
    return None


def locate_binary(custom_path=None):
    if custom_path and os.path.exists(custom_path):
        return custom_path

    running_path = find_running_binary()
    if running_path and os.path.exists(running_path):
        return running_path

    for p in DEFAULT_BINARY_PATHS:
        if os.path.exists(p):
            return p

    return None


def extract_credentials(binary_path):
    print(f"[*] 正在分析本地二进制文件: {binary_path}")
    with open(binary_path, "rb") as f:
        data = f.read()

    # Dynamically discover all Google OAuth Client IDs and Secrets in the binary
    client_ids = set(re.findall(rb"(\d{10,}-[a-z0-9_]+\.apps\.googleusercontent\.com)", data))
    client_secrets = set(re.findall(rb"(GOCSPX-[a-zA-Z0-9_\-]{28})", data))

    decoded_clients = [c.decode("utf-8") for c in client_ids]
    decoded_secrets = [s.decode("utf-8") for s in client_secrets]

    print(f"[*] 发现 {len(decoded_clients)} 个 Client ID, {len(decoded_secrets)} 个 Client Secret")

    result = {}

    # Heuristic pairing based on binary context tags
    # 1. Jetbox / OAuthState
    for cid in decoded_clients:
        pos = data.find(cid.encode("utf-8"))
        if pos != -1:
            context = data[max(0, pos-200):min(len(data), pos+200)]
            if b"Jetbox" in context:
                # Find the jetbox secret (preceded by CONVERSATION_GROUP_SORT_MODE_CUSTOM or similar)
                for sec in decoded_secrets:
                    spos = data.find(sec.encode("utf-8"))
                    if spos != -1 and b"CONVERSATION_GROUP_SORT_MODE_CUSTOM" in data[max(0, spos-100):spos]:
                        result["jetbox"] = {"client_id": cid, "client_secret": sec}
                        break

    # 2. Business (SetUserTier)
    for cid in decoded_clients:
        pos = data.find(cid.encode("utf-8"))
        if pos != -1:
            context = data[max(0, pos-200):min(len(data), pos+200)]
            if b"SetUserTier" in context or b"runtime.Goexit" in context:
                for sec in decoded_secrets:
                    spos = data.find(sec.encode("utf-8"))
                    if spos != -1 and b"auth.cloud.google" in data[max(0, spos-100):spos]:
                        result["business"] = {"client_id": cid, "client_secret": sec}
                        break

    # 3. Consumer (HTTP3 / user arena)
    for cid in decoded_clients:
        pos = data.find(cid.encode("utf-8"))
        if pos != -1:
            context = data[max(0, pos-200):min(len(data), pos+200)]
            if b"HTTP3" in context or b"user arena" in context:
                for sec in decoded_secrets:
                    spos = data.find(sec.encode("utf-8"))
                    if spos != -1 and b"generateContent" in data[max(0, spos-100):spos]:
                        result["consumer"] = {"client_id": cid, "client_secret": sec}
                        break

    return result


def main():
    parser = argparse.ArgumentParser(description="Extract Google OAuth credentials from Antigravity language_server binary.")
    parser.add_argument("--binary", "-b", help="Path to language_server binary")
    parser.add_argument("--output", "-o", default=DEFAULT_GLOBAL_OUTPUT, help="Target output JSON path")
    parser.add_argument("--local", action="store_true", help="Also save to local worker/oauth_clients.json")
    parser.add_argument("--print", "-p", action="store_true", help="Print extracted credentials to stdout")
    parser.add_argument("--dry-run", action="store_true", help="Scan and display without writing to file")

    args = parser.parse_args()

    binary_path = locate_binary(args.binary)
    if not binary_path:
        print("[!] 错误: 未能在常见路径中找到 language_server 二进制文件。")
        print("    请通过 --binary 指定其绝对路径，例如:")
        print("    python3 scripts/extract_oauth_clients.py --binary /path/to/language_server")
        sys.exit(1)

    creds = extract_credentials(binary_path)

    if not creds:
        print("[!] 未能成功提取和配对凭证。")
        sys.exit(1)

    print(f"\n[+] 成功解析出 {len(creds)} 组客户端凭证配置: {list(creds.keys())}")

    if args.print or args.dry_run:
        print("\n" + json.dumps(creds, indent=2))

    if not args.dry_run:
        out_dir = os.path.dirname(args.output)
        if not os.path.exists(out_dir):
            os.makedirs(out_dir, exist_ok=True)

        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(creds, f, indent=2)
        print(f"[✔] 已保存至: {args.output}")

        if args.local:
            local_path = os.path.join(os.path.dirname(__file__), "../worker/oauth_clients.json")
            with open(local_path, "w", encoding="utf-8") as f:
                json.dump(creds, f, indent=2)
            print(f"[✔] 已同步至本地: {local_path}")

    print("\n完成！现在您可以正常使用多账号切换服务。")


if __name__ == "__main__":
    main()
