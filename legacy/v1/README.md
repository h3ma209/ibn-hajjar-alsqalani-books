# Legacy v1 scripts

Deprecated prototype. Use the v2 pipeline in `code/` instead.

These scripts expect the Shamela `.bok` in the working directory or via `--bok`. With the new layout, point them at:

```
../../data/source/isabah/الإصابة في تمييز الصحابة.bok
```

Example:

```bash
node extract-persons.js search "abu huraira" \
  --bok ../../data/source/isabah/الإصابة\ في\ تمييز\ الصحابة.bok
```
