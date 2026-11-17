# Migration plan

We will <a id="c-x7k2m9"></a>move every tenant<a id="c-x7k2m9-end"></a> to the new cluster in Q3.

<a id="c-4f9tq1"></a>

```sh
./migrate --all --window 2h
```

<a id="c-4f9tq1-end"></a>

Rollback is manual.

## Comments

| Ref | Quote | Author | Date | Comment | Status |
|---|---|---|---|---|---|
| [c-x7k2m9](#c-x7k2m9) | We will **move every tenant** to the new cluster in Q3. | @wayne | 2026-11-17T10:32Z | Including the EU tenants? | |
| [c-x7k2m9](#c-x7k2m9) | | @alex | 2026-11-17T11:02Z | Yes, added a note below. | resolved |
| [c-4f9tq1](#c-4f9tq1) | to the new cluster in Q3. **./migrate --all --window 2h** Rollback is manual. | @sam | 2026-11-17T12:40Z | Is 2h enough for the largest tenant? | |
| c-m3k8za | | @wayne | 2026-11-17T13:00Z | Needs an owner before we circulate it. | |
