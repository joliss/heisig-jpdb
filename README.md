# Compare Heisig and jpdb.io keywords

👉 View the comparison tables at **[joliss.github.io/heisig-jpdb/](https://joliss.github.io/heisig-jpdb/)**.

## Contributing

### Initial setup

```
npm install -g pnpm
pnpm install
```

### Rebuilding

```
pnpm run build
```

The initial build will take about an hour, as keywords are scraped from jpdb.io.
Subsequent builds will be faster, as scraped data is cached in the `.cache`
directory.

## License

The code in this repository is licensed under the Apache 2.0 License. All rights
to the keyword lists remain with their respective owners.
