#!/usr/bin/env python3
import argparse
import os
import subprocess
import sys


def main() -> int:
  parser = argparse.ArgumentParser(description="Start a detached process and write its pid.")
  parser.add_argument("--pid-file", required=True)
  parser.add_argument("--log-file", required=True)
  parser.add_argument("--cwd", default=".")
  parser.add_argument("cmd", nargs=argparse.REMAINDER)
  args = parser.parse_args()

  command = args.cmd[1:] if args.cmd and args.cmd[0] == "--" else args.cmd
  if not command:
    parser.error("No command provided.")

  pid_dir = os.path.dirname(os.path.abspath(args.pid_file))
  log_dir = os.path.dirname(os.path.abspath(args.log_file))
  if pid_dir:
    os.makedirs(pid_dir, exist_ok=True)
  if log_dir:
    os.makedirs(log_dir, exist_ok=True)

  with open(args.log_file, "ab", buffering=0) as log_file:
    process = subprocess.Popen(
      command,
      cwd=args.cwd,
      stdin=subprocess.DEVNULL,
      stdout=log_file,
      stderr=subprocess.STDOUT,
      start_new_session=True,
      close_fds=True
    )

  with open(args.pid_file, "w", encoding="utf-8") as pid_file:
    pid_file.write(f"{process.pid}\n")

  print(process.pid)
  return 0


if __name__ == "__main__":
  sys.exit(main())
