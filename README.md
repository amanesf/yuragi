# ゆらぎ

墨がにじみ、光が流れる。大正の少女をめぐる、ゆらぎ。

**https://amanesf.github.io/yuragi/**

なぞれば墨が退き、叩けば光が寄り、押さえ続ければ渦が育つ。設計は [`plan.md`](plan.md)。

```sh
cd app && npm ci && npm run dev
```

撮影（実機サイズの静止画）:

```sh
npm ci && (cd app && npm run build)
node scripts/capture.js --at 1.5,4,8,16 --touch 1
```
