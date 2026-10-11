import os
import signal
import subprocess
import time
from contextlib import contextmanager


@contextmanager
def cancellation_signals(stop):
    interrupted = False

    def cancel(number, _frame):
        nonlocal interrupted
        stop.set()
        if not interrupted:
            interrupted = True
            raise KeyboardInterrupt("received " + signal.Signals(number).name)

    previous = {
        number: signal.getsignal(number) for number in (signal.SIGINT, signal.SIGTERM)
    }
    try:
        for number in previous:
            signal.signal(number, cancel)
        yield
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)


def run_process(command, *, cwd, env, stdout, stderr, timeout, stop=None):
    if stop is not None and stop.is_set():
        raise ValueError("batch cancelled after a failed model call")
    started = time.monotonic()
    proc = subprocess.Popen(
        command,
        cwd=cwd,
        env=env,
        stdout=stdout,
        stderr=stderr,
        text=True,
        start_new_session=True,
    )
    try:
        while proc.poll() is None:
            if stop is not None and stop.is_set():
                raise ValueError("batch cancelled after a failed model call")
            if time.monotonic() - started >= timeout:
                raise subprocess.TimeoutExpired(command, timeout)
            time.sleep(0.05)
        return proc.returncode
    finally:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait()
