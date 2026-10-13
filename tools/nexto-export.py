"""
Export the Nexto policy (Rolv-Arild/Necto, rlbot-support/Nexto/nexto-model.pt — CC BY-NC-SA 4.0) to a flat
float32 file the TypeScript port (client/src/rocket/sim/nexto.ts) reads, plus a test vector to check the port.
  python3 -m venv /tmp/nx && /tmp/nx/bin/pip install torch numpy
  /tmp/nx/bin/python tools/nexto-export.py path/to/nexto-model.pt
"""
import json, sys
import numpy as np
import torch

model = torch.jit.load(sys.argv[1])
params = dict(model.named_parameters())
order = [
    'net.earl.query_preprocess.0.weight', 'net.earl.query_preprocess.0.bias',
    'net.earl.query_preprocess.2.weight', 'net.earl.query_preprocess.2.bias',
    'net.earl.key_value_preprocess.0.weight', 'net.earl.key_value_preprocess.0.bias',
    'net.earl.key_value_preprocess.2.weight', 'net.earl.key_value_preprocess.2.bias',
]
for b in range(2):
    p = f'net.earl.blocks.{b}.'
    order += [p + 'attention.in_proj_weight', p + 'attention.in_proj_bias', p + 'attention.out_proj.weight', p + 'attention.out_proj.bias',
              p + 'linear1.weight', p + 'linear1.bias', p + 'linear2.weight', p + 'linear2.bias',
              p + 'norm1.weight', p + 'norm1.bias', p + 'norm2.weight', p + 'norm2.bias', p + 'norm3.weight', p + 'norm3.bias']
order += ['net.output.net.0.weight', 'net.output.net.0.bias', 'net.output.net.2.weight', 'net.output.net.2.bias',
          'net.output.net.4.weight', 'net.output.net.4.bias', 'net.output.emb_convertor.weight', 'net.output.emb_convertor.bias']
assert set(order) == set(params), set(params) ^ set(order)
# The action table baked into the output head (CONSTANTS.c0) and the attention scale.
consts = list(model.net.output.code_with_constants[1].const_mapping.values())
table = [c for c in consts if isinstance(c, torch.Tensor)][0].float()
att = list(getattr(model.net.earl.blocks, '0').attention.code_with_constants[1].const_mapping.values())
print('attention constants', att)
chunks = [table.flatten()] + [params[n].detach().float().flatten() for n in order]
flat = torch.cat(chunks).numpy().astype('<f4')
out = 'client/public/assets/nexto/nexto.bin'
flat.tofile(out)
print('wrote', out, flat.size, 'floats; action table', tuple(table.shape))

# Test vector: random observation (3 players: self + mate + 2 opps = 4 players, ball, 34 boosts).
torch.manual_seed(1)
q = torch.randn(1, 1, 32)
kv = torch.randn(1, 4 + 1 + 34, 24)
m = torch.zeros(1, 4 + 1 + 34)
with torch.no_grad():
    logits, _ = model((q, kv, m))
json.dump({'q': q.flatten().tolist(), 'kv': kv.flatten().tolist(), 'logits': logits.flatten().tolist()},
          open('smoke-out/nexto-test.json', 'w'))
print('logits', logits.shape, logits.flatten()[:5].tolist())
