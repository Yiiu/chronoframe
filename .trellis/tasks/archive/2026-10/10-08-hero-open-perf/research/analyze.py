import json, collections, sys
p = json.load(open(sys.argv[1]))
nodes = {n['id']: n for n in p['nodes']}
parent = {}
for n in p['nodes']:
    for c in n.get('children', []): parent[c] = n['id']
# 样本时间
dts = p['timeDeltas']; samples = p['samples']
selft = collections.Counter(); incl = collections.Counter(); comp = collections.Counter()
def name(n):
    cf = n['callFrame']; u = cf['url'].split('?')[0].split('/')[-1]
    return f"{cf['functionName'] or '(anon)'} {u}:{cf['lineNumber']+1}"
def comp_of(n):
    u = n['callFrame']['url'].split('?')[0]
    if not u: return n['callFrame']['functionName'] or '(native)'
    if 'node_modules' in u or '.vite/deps' in u or '/deps/' in u:
        seg = u.split('node_modules/')[-1].split('/deps/')[-1]
        return 'dep:' + seg.split('/')[0].split('.')[0].split('?')[0]
    return 'app:' + u.split('/')[-1]
for s, dt in zip(samples, dts):
    dt /= 1000
    n = nodes[s]; selft[name(n)] += dt
    seen = set(); cur = s; seen_c = set()
    while cur is not None:
        nn = nodes[cur]; k = name(nn)
        if k not in seen: incl[k] += dt; seen.add(k)
        c = comp_of(nn)
        if c not in seen_c: comp[c] += dt; seen_c.add(c)
        cur = parent.get(cur)
total = sum(dts) / 1000
idle = selft.get('(idle) :0', 0)
print(f'profile {total:.0f}ms, idle {idle:.0f}ms')
print('\n== top self time'); [print(f'{v:7.1f}ms  {k}') for k, v in selft.most_common(18)]
print('\n== top inclusive (app files)'); [print(f'{v:7.1f}ms  {k}') for k, v in incl.most_common(200) if any(x in k for x in ['.vue', '.ts:', 'webgl', 'Hero', 'hero'])][:0]
for k, v in [kv for kv in incl.most_common(400) if any(x in kv[0] for x in ['.vue:', '.ts:'])][:25]: print(f'{v:7.1f}ms  {k}')
print('\n== by file/dependency (inclusive)'); [print(f'{v:7.1f}ms  {k}') for k, v in comp.most_common(22)]
