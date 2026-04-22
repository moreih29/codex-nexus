# Upstream vs downstream triage for Nexus-family issues

## When a problem occurs

1. Reproduce or inspect the failure enough to identify the immediate cause.
2. Decide whether the root cause belongs to `nexus-core` or to this repository/wrapper/integration layer.
3. If the issue requires a `nexus-core` change, open an upstream issue in `moreih29/nexus-core` with:
   - symptom
   - repro shape
   - root-cause evidence
   - why the fix belongs upstream
   - downstream impact/workaround if any
4. If the issue is local to this repository, fix it directly here.
5. If both are true, do both:
   - mitigate or fix locally as needed
   - also file the upstream `nexus-core` issue when the upstream assumption/design should be improved

## Decision rule

- **`nexus-core` issue** when the problematic assumption or generated behavior originates in `nexus-core`.
- **Local fix** when the bug is caused by this repository's installer, wrapper, packaging, configuration, or integration decisions.
- **Both** when local mitigation is needed but the originating assumption still belongs upstream.

## Expected behavior going forward

For Nexus-related failures, do root-cause triage first, then:
- upstream-worthy -> file `nexus-core` issue
- local-only -> fix here
- mixed responsibility -> fix here and file upstream
