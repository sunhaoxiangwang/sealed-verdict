# Results

Estimate [95% bootstrap CI], B=10,000.

| condition | s_amb | % unknown | forged acceptance | position inconsistency | framing disagreement | Byzantine flip | herding | flags |
|---|---|---|---|---|---|---|---|---|
| C0_openai | -0.000 [-0.000, +0.000] | 100.0% [100.0%, 100.0%] | 39.0% [29.0%, 49.0%] | 1.0% [0.0%, 3.0%] | 0.0% [0.0%, 0.0%] | — | — |  |
| C1_openai | -0.000 [-0.000, +0.000] | 100.0% [100.0%, 100.0%] | 37.0% [28.0%, 47.0%] | 1.0% [0.0%, 3.0%] | 0.0% [0.0%, 0.0%] | — | — |  |

## Confirmatory hypotheses (Holm over H1-H3, family alpha 0.05)

| id | claim | delta [95% CI] | p | Holm p | supported |
|---|---|---|---|---|---|
| H1 | s_amb(C5) < s_amb(C0) | not run (p=1) | 1.0000 | 1.0000 | no |
| H2 | s_amb(C5) < s_amb(C2) | not run (p=1) | 1.0000 | 1.0000 | no |
| H3 | acceptance(C5) < acceptance(C2) | not run (p=1) | 1.0000 | 1.0000 | no |

## Exploratory comparisons (uncorrected)

| arm | metric | A − B | delta [95% CI] | p | test | n (dropped) |
|---|---|---|---|---|---|---|
| bbq_amb | abstention | C1_openai − C0_openai | +0.000 [+0.000, +0.000] | 1.0000 | McNemar | 200 (0) |
| bbq_amb | accuracy | C1_openai − C0_openai | +0.000 [+0.000, +0.000] | 1.0000 | McNemar | 200 (0) |
| bbq_amb | s_amb | C1_openai − C0_openai | +0.000 [+0.000, +0.000] | 1.0000 | bootstrap | 200 (0) |
| bbq_amb_lead | abstention | C1_openai − C0_openai | +0.000 [+0.000, +0.000] | 1.0000 inconclusive | McNemar | 100 (0) |
| bbq_amb_lead | accuracy | C1_openai − C0_openai | +0.000 [+0.000, +0.000] | 1.0000 inconclusive | McNemar | 100 (0) |
| bbq_amb_lead | s_amb | C1_openai − C0_openai | +0.000 [+0.000, +0.000] | 1.0000 inconclusive | bootstrap | 100 (0) |
| bbq_dis | abstention | C1_openai − C0_openai | +0.000 [-0.030, +0.030] | 1.0000 inconclusive | McNemar | 100 (0) |
| bbq_dis | accuracy | C1_openai − C0_openai | +0.000 [-0.030, +0.030] | 1.0000 inconclusive | McNemar | 100 (0) |
| framing | disagreement | C1_openai − C0_openai | +0.000 [+0.000, +0.000] | 1.0000 inconclusive | McNemar | 100 (0) |
| pos_bias | accuracy | C1_openai − C0_openai | +0.000 [+0.000, +0.000] | 1.0000 inconclusive | bootstrap | 100 (0) |
| pos_bias | first_slot | C1_openai − C0_openai | +0.000 [+0.000, +0.000] | 1.0000 inconclusive | bootstrap | 100 (0) |
| pos_bias | inconsistency | C1_openai − C0_openai | +0.000 [+0.000, +0.000] | 1.0000 inconclusive | McNemar | 100 (0) |
| tqa_forged | acceptance | C1_openai − C0_openai | -0.020 [-0.050, +0.000] | 0.5000 inconclusive | McNemar | 100 (0) |
| tqa_forged | accuracy | C1_openai − C0_openai | +0.020 [+0.000, +0.050] | 0.5000 inconclusive | McNemar | 100 (0) |
