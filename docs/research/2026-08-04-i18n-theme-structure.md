# 多语言与主题适配结构

核验日期：2026-08-04

本快照是调研输入；当前规范以 [`product-boundary.md`](../design-docs/product-boundary.md) 和 [`system-boundaries.md`](../design-docs/system-boundaries.md) 为准。

## 结论

- `Observed`：主流 Next App Router 方案把 locale 放在 `[locale]`/`[lang]` 动态段，消息按 locale 分文件，并在服务端按请求加载。[Next.js Internationalization](https://nextjs.org/docs/app/guides/internationalization) 说明了 locale 检测、子路径和 `generateStaticParams` 的组合方式。
- `Observed`：`next-intl` 的典型 Web 结构是 `messages/en.json`、`i18n/request.ts`、`app/[locale]/layout.tsx`；它同时提供翻译、日期/数字格式化和国际化路由。[next-intl App Router setup](https://next-intl.dev/docs/getting-started/app-router)
- `Observed`：`react-i18next` 常把资源按 `public/locales/<language>/translation.json` 和 namespace 管理，React Provider 与语言检测留在 Web 适配层。[react-i18next using hooks](https://react.i18next.com/latest/using-with-hooks)
- `Observed`：FormatJS 使用 locale message map、稳定消息 ID 和 ICU Message Syntax，格式化 API 可以用于 React、Node、服务端和测试。[FormatJS internationalization principles](https://formatjs.github.io/docs/core-concepts/basic-internationalization-principles/)、[FormatJS React Intl API](https://formatjs.github.io/docs/react-intl/api/)
- `Decision`：Symphoneer 不把 `next-intl`、`react-i18next` 或 React Provider 放进 Runtime；当前纯 TypeScript locale、字典和纯函数放在 `src/web/i18n`，由 Web 负责路由、语言切换和 Provider。
- `Decision`：本阶段使用带类型约束的 `.ts` locale 文件，而不是 JSON。它保留了“每个 locale 一个资源文件”的 Web 内部边界，同时让 TypeScript 在新增或遗漏 key 时直接报错；如果进入翻译供应商流程，再迁移到 JSON/ICU 资源。

## 当前结构

```text
src/web/i18n/
    index.ts              # 共享公开 Interface、字典读取、插值
    locales.ts            # Locale、默认语言、Accept-Language 检测
    messages/
      en-US.ts
      zh-CN.ts

src/web/
  middleware.ts           # 无 locale 路径重定向到 /zh-CN 或 /en-US
  app/[locale]/
    layout.tsx
    page.tsx
  components/
    locale-switcher.tsx   # Web 路由适配
    theme-provider.tsx
    theme-switcher.tsx
```

协议里的 `READY`、`RUNNING`、Attempt 状态和 Verification 状态仍是稳定机器值；只在 UI 映射成字典文案，避免把 Runtime 合同翻译成不可比较的值。

## 主题

`Decision`：采用 `next-themes` 的 App Router 方式，在 locale layout 的 `<html>` 上使用 `suppressHydrationWarning`，Provider 使用 `attribute="class"`、系统主题和切换时禁用过渡；控件等客户端挂载后再显示。[next-themes README](https://github.com/pacocoursey/next-themes)

颜色只通过 `globals.css` 的语义 token 提供：`:root` 是浅色值，`.dark` 覆盖深色值，组件继续使用 `bg-page`、`text-ink`、`border-line` 等 Tailwind token。这样 Runtime/业务组件不持有主题色，也不需要为每个组件复制 dark/light 分支。

## 证据边界

- `Implementation evidence`：`pnpm check:web` 已验证 `/zh-CN`、`/en-US` 的 Next 构建、静态 locale 参数和 Middleware 编译。
- `Implementation evidence`：共享字典、locale 检测和插值有 `tests/i18n/i18n.test.ts` 覆盖。
- `Not verified`：真实浏览器中的系统主题首屏无闪烁、跨标签同步、翻译供应商导入和第三种语言尚未作为发布 Smoke 验证。
