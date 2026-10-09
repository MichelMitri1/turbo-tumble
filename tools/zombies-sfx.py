"""
Zombies sounds from CC0 Freesound recordings (macOS: afconvert; needs numpy).

  python3 tools/zombies-sfx.py <dir with the downloaded <id>.mp3 previews>

Sources (all Creative Commons 0):
  125405  "Monster Groans, Grunts, Slobbers"   -> groan1..6
  463721  "Burp Monster Zombie groan moan"     -> groan7
  426637  "Zombie Choking"                     -> groan8
  133974  "Horrific Zombie Growl"              -> attack
  249495  "3 Headed Dog"                       -> dog1, dog2
  404920  "Dog Growl - Beast / Creature"       -> dog3
  873248  "Layered Cracking Thin Plywood Board" -> board1..3 (zombies tearing boards)
  394891  "hammer pounding on wood"            -> hammer1..3 (rebuilding)
  274379  "creepy music box"                   -> box (mystery box jingle)
  556701  "Ghost Monster Scream"               -> howl (hellhound round)
"""
import os, subprocess, sys, wave
import numpy as np

SRC = sys.argv[1]
OUT = 'client/public/assets/fps/zsfx'
SR = 44100
os.makedirs(OUT, exist_ok=True)

def load(i):
    wav = os.path.join(SRC, f'{i}.wav')
    if not os.path.exists(wav):
        subprocess.run(['afconvert', '-f', 'WAVE', '-d', f'LEI16@{SR}', '-c', '1', os.path.join(SRC, f'{i}.mp3'), wav], check=True)
    w = wave.open(wav)
    return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768

def cut(a, t0, t1, fin=0.02, fout=0.12):
    s = a[int(t0 * SR):int(t1 * SR)].copy()
    n0, n1 = int(fin * SR), int(fout * SR)
    if n0: s[:n0] *= np.linspace(0, 1, n0)
    if n1: s[-n1:] *= np.linspace(1, 0, n1)
    return s

def save(name, s, peak=0.9):
    s = s / (np.abs(s).max() + 1e-9) * peak
    tmp = os.path.join(SRC, name + '.out.wav')
    w = wave.open(tmp, 'wb')
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((s * 32767).astype(np.int16).tobytes())
    w.close()
    out = os.path.join(OUT, name + '.m4a')
    subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '80000', tmp, out], check=True)
    print(out, f'{len(s) / SR:.1f}s', os.path.getsize(out) // 1024, 'KB')

g = load(125405)
for i, (a, b) in enumerate([(1.6, 2.7), (4.8, 6.0), (20.6, 22.1), (22.8, 24.7), (32.9, 34.1), (35.7, 37.1)]):
    save(f'groan{i + 1}', cut(g, a, b), 0.85)
save('groan7', cut(load(463721), 0.0, 2.5), 0.85)
save('groan8', cut(load(426637), 0.0, 3.6), 0.85)
save('attack', cut(load(133974), 0.0, 2.6, 0.005, 0.4))
d = load(249495)
save('dog1', cut(d, 2.2, 4.6))
save('dog2', cut(d, 5.8, 6.6))
save('dog3', cut(load(404920), 5.0, 8.4))
wd = load(873248)
for i, (a, b) in enumerate([(0.6, 1.45), (6.8, 7.45), (10.2, 11.0)]):
    save(f'board{i + 1}', cut(wd, a, b, 0.005, 0.15))
hm = load(394891)
for i, (a, b) in enumerate([(0.55, 0.95), (1.75, 2.15), (2.55, 2.95)]):
    save(f'hammer{i + 1}', cut(hm, a, b, 0.002, 0.1))
save('box', cut(load(274379), 2.2, 6.6, 0.05, 0.6), 0.7)
save('howl', cut(load(556701), 9.6, 11.6, 0.05, 0.5))
