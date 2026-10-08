"""
Matchday sounds from CC0 Freesound recordings (macOS: uses afconvert; needs numpy).

  python3 tools/football-sfx.py <dir with the downloaded <id>.mp3 previews>

Sources (all Creative Commons 0):
  528799  "Football Crowd - Reaction To Goal"        -> crowd loop, goal roar
  397434  "Crowd Cheer"                               -> cheer
  619007  "crowd oh disappointed"                     -> ooh (near miss)
  538422  "Referee whistle sound"                     -> whistle
  555042  "Soccer Ball Kick", 261267 "Soccer Kick"    -> kicks
"""
import os, subprocess, sys, wave
import numpy as np

SRC = sys.argv[1]
OUT = 'client/public/assets/football/sfx'
SR = 44100
os.makedirs(OUT, exist_ok=True)

def load(i):
    wav = os.path.join(SRC, f'{i}.wav')
    if not os.path.exists(wav):
        subprocess.run(['afconvert', '-f', 'WAVE', '-d', f'LEI16@{SR}', '-c', '1', os.path.join(SRC, f'{i}.mp3'), wav], check=True)
    w = wave.open(wav)
    return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768

def cut(a, t0, t1, fin=0.01, fout=0.05):
    s = a[int(t0 * SR):int(t1 * SR)].copy()
    n0, n1 = int(fin * SR), int(fout * SR)
    if n0: s[:n0] *= np.linspace(0, 1, n0)
    if n1: s[-n1:] *= np.linspace(1, 0, n1)
    return s

def loop(a, t0, t1, xf=1.5):
    """Seamless loop: the tail crossfades into the head."""
    s = a[int(t0 * SR):int(t1 * SR)].copy()
    n = int(xf * SR)
    head, tail = s[:n], s[-n:]
    k = np.linspace(0, 1, n)
    s = s[n:].copy()
    s[-n:] = tail * (1 - k) + head * k
    return s

def save(name, s, peak=0.85):
    s = s / (np.abs(s).max() + 1e-9) * peak
    tmp = os.path.join(SRC, name + '.wav')
    w = wave.open(tmp, 'wb')
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((s * 32767).astype(np.int16).tobytes())
    w.close()
    out = os.path.join(OUT, name + '.m4a')
    subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '96000', tmp, out], check=True)
    print(out, f'{len(s) / SR:.1f}s', os.path.getsize(out) // 1024, 'KB')

goal = load(528799)
save('crowd', loop(goal, 26, 46), 0.6)
save('goal', cut(goal, 3.0, 19, 0.02, 4.0))
save('cheer', cut(load(397434), 0.0, 7.5, 0.3, 2.5))
save('ooh', cut(load(619007), 0.3, 4.3, 0.05, 1.0))
save('whistle', cut(load(538422), 0.0, 0.5, 0.005, 0.08))
save('kick1', cut(load(555042), 0.0, 0.35, 0.0, 0.1), 0.9)
save('kick2', cut(load(261267), 0.0, 0.35, 0.0, 0.1), 0.9)
