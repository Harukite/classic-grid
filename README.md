# Classic Grid — 五所经典网格（开源）

等差网格：现价下买上卖，**成交后补相邻反向单**；启动校验格距 > 双边手续费、保证金预检。

支持交易所适配器：**Extended / RISEx / Decibel / N1 / Phoenix**。

> 本仓库为开源模板，**不含任何私钥、API Key、服务器地址或运行数据**。  
> 作者：[beibei030](https://github.com/beibei030)

---

## 推荐注册（请走推荐链接）

开户/入金前请优先使用下列推荐链接（对作者有帮助，功能与官方入口相同）：

| 交易所 | 推荐链接 |
|--------|----------|
| **Decibel** | https://app.decibel.trade/r/K7B2QM |
| **Phoenix** | https://phoenix.trade/?code=YNS0TXV0 |
| **Extended** | https://app.extended.exchange/join/AIQIANG888 |
| **N1** | https://app.n1.xyz/r/orderly-loop-curve |
| **RISEx** | https://rise.trade/（暂无推荐码，官网注册即可） |

---

## 给 AI / 开发者的快速说明

你是助手时，按下面做即可跑通本项目，**不要**向仓库写入真实密钥：

1. `npm install`
2. 复制 `.env.example` → `.env`，只填用户本机密钥；保持 `DRY_RUN=1` 直到用户明确要实盘
3. 核心策略在 `src/grid.ts`（铺单 / 成交补反向单 / skipBand）
4. 交易所实现在 `src/venues/*.ts`，工厂在 `src/venues/index.ts`
5. 运行循环 `src/loop.ts`；看板 `src/dashboard.ts` + `public/index.html`
6. 干跑：`npm start -- --once` 或 `DRY_RUN=1 npm start`
7. 实盘：用户确认后 `DRY_RUN=0` + `LIVE_CONFIRM=YES`；N1 另需 `N1_TRADING_ARMED=YES`
8. 看板默认 `http://127.0.0.1:8088/` → `/api/snapshot`
9. 加新所：扩展 `VenueId` → 实现 `VenueExecutor` → 挂进 `createExecutor` / `config` / 看板标签
10. **禁止**提交 `.env`、`secrets/`、`data/`；**禁止**把生产机器 IP/密码写进文档

---

## 本机命令

```bash
npm install
cp .env.example .env   # Windows: copy .env.example .env
npm test
DRY_RUN=1 npm start -- --once
npm run status
npm run dashboard
npm run flat           # 清仓撤单（危险，仅用户明确要求时）
```

Windows PowerShell 干跑示例：

```powershell
$env:DRY_RUN="1"; npm start -- --once
```

---

## 默认网格参数（可按 `.env` 调整）

| 所 | 默认格数 | 默认杠杆 | 备注 |
|----|----------|----------|------|
| Extended | 80 | 30x | 半幅约 ±4.6%（相对 REF_MID） |
| Decibel / N1 | 65 | 30x | 同上 |
| RISEx | 46 | 25x | 半幅约 ±3% |
| Phoenix | 随 config | 随 env | Solana 永续，见 `src/venues/phoenix.ts` |

`GRID_MARGIN_FRAC` 默认 `0.7`。重启可用 `SOFT_RESUME=1` 从 `data/status.json` 恢复锚点（该文件本地生成，勿提交）。

---

## 目录结构

```
src/
  grid.ts           # 策略核心
  loop.ts           # 主循环
  config.ts         # 参数与锚点
  dashboard.ts      # HTTP 看板
  officialStats.ts  # 今日量/费/平仓盈亏（各所接口）
  telegram.ts       # 可选通知
  venues/           # 五所适配器
public/index.html   # 看板前端
vendor/             # Extended / RISEx 等轻量封装（无密钥）
test/               # 网格单测
```

---

## 安全与免责

- 永续合约与杠杆交易有爆仓与本金损失风险；开源软件按现状提供，作者不对交易盈亏负责。
- 切勿在聊天或 Issue 中粘贴私钥 / API Secret。
- 推荐链接仅方便注册，不构成投资建议。

## License

MIT（见 `LICENSE`）。
