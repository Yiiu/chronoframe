# 按点击后时间列出 canvas2d / WebGL 原生调用及其调用方（压缩包也能看出模块）
import json, collections, sys
p = json.load(open(sys.argv[1]))
nodes = {n['id']: n for n in p['nodes']}
parent = {c: n['id'] for n in p['nodes'] for c in n.get('children', [])}
def nm(i):
    cf = nodes[i]['callFrame']; return f"{cf['functionName'] or '(anon)'} {cf['url'].split('?')[0].split('/')[-1]}:{cf['lineNumber']+1}"
WATCH = {'getContext','getProgramParameter','fill','addColorStop','getImageData','createLinearGradient','drawImage','texImage2D'}
agg = collections.defaultdict(float); when = collections.defaultdict(list); t = p['startTime']
for s, dt in zip(p['samples'], p['timeDeltas']):
    t += dt; leaf = nodes[s]['callFrame']['functionName']
    if leaf in WATCH:
        ch = []; cur = parent.get(s)
        while cur is not None and len(ch) < 3: ch.append(nm(cur)); cur = parent.get(cur)
        k = (leaf, ' <- '.join(ch)); agg[k] += dt / 1000; when[k].append(round((t - p['startTime']) / 1000))
inflight = 0
for (leaf, ch), v in sorted(agg.items(), key=lambda kv: min(when[kv[0]])):
    w = when[(leaf, ch)]; early = sum(1 for x in w if x <= 450)
    if min(w) <= 450: inflight += v
    print(f'{v:6.1f}ms {leaf:20} t={min(w)}-{max(w)}ms  <- {ch}')
print(f'canvas/WebGL native time starting inside 0-450ms: {inflight:.1f}ms')
