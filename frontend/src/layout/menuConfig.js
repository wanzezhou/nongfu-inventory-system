/**
 * 侧边栏菜单配置 —— 菜单标题/图标的单一数据源（A8，2026-09-04）
 * MainLayout.vue 据此渲染菜单；router/index.js 导入 MENU_TITLES 生成 meta.title
 * （此前菜单写死在 MainLayout 模板、标题又复制一份到 router meta，双份维护易漂移）
 *
 * 2026-09-16（晚 2）菜单三级化：
 *   - 新增一级「财务管理」，收纳「营收统计 / 成本统计 / 工资统计 / 利润统计」四个二级项
 *   - 「营收统计 / 成本统计 / 利润统计」下的页面从侧边栏移出，改由内容区顶部三级标签栏
 *     （layout/NavTabs.vue）呈现 —— 组定义见下方 tabGroups，侧边栏与标签栏同源
 *   - 侧边栏二级项的 index 为虚拟键（/fm/xxx），真实跳转目标在 to 字段：
 *     这样 MENU_TITLES 仍只映射「真实页面路径 → 页面标题」，不会被二级菜单标题污染
 *
 * ⚠️ 改菜单只改本文件：router 的 meta.title 与面包屑都从这里派生。
 *    新增真实页面必须登记进 menuGroups（item / group.items）或 tabGroups[].tabs。
 */
import {
  HomeFilled, Folder, Goods, Shop, OfficeBuilding, User, Wallet,
  DataAnalysis, Box, Document, TrendCharts, DataLine, Money, Van,
  ShoppingCart, Coin, Ticket
} from '@element-plus/icons-vue'

// ---------------------------------------------------------------------------
// 三级标签组：二级菜单下「页面级」的入口，在内容区顶部以标签栏形式切换。
// 每组 key 对应侧边栏虚拟 index `/fm/<key>`，entry 为该组默认落地页。
// ---------------------------------------------------------------------------
export const tabGroups = [
  {
    key: 'revenue',
    title: '营收统计',
    icon: Money,
    entry: '/finance/platform',
    tabs: [
      { index: '/finance/platform', title: '送水到府', icon: Van },
      { index: '/finance/water-commune', title: '水公社', icon: ShoppingCart },
      { index: '/finance/distribution', title: '直营水站销售', icon: Goods },
      { index: '/finance/retail', title: '线下零售', icon: ShoppingCart },
      { index: '/finance/bulk-machine', title: '量贩机', icon: Wallet },
      { index: '/finance/retail-machine', title: '零售机', icon: Van }
    ]
  },
  {
    key: 'cost',
    title: '成本统计',
    icon: Coin,
    entry: '/cost/summary',
    tabs: [
      { index: '/cost/summary', title: '成本汇总', icon: TrendCharts },
      { index: '/cost/platform', title: '送水到府', icon: Van },
      { index: '/cost/water-commune', title: '水公社', icon: ShoppingCart },
      { index: '/cost/distribution', title: '直营水站销售', icon: Goods },
      { index: '/cost/retail', title: '线下零售', icon: ShoppingCart },
      { index: '/cost/bulk-machine', title: '量贩机', icon: Wallet },
      { index: '/cost/retail-machine', title: '零售机', icon: Van },
      { index: '/cost/expenses', title: '其他支出', icon: Wallet }
    ]
  },
  {
    key: 'profit',
    title: '利润统计',
    icon: TrendCharts,
    entry: '/profit/platform',
    tabs: [
      { index: '/profit/platform', title: '送水到府', icon: Van },
      { index: '/profit/water-commune', title: '水公社', icon: ShoppingCart },
      { index: '/profit/distribution', title: '直营水站销售', icon: Goods },
      { index: '/profit/retail', title: '线下零售', icon: ShoppingCart },
      { index: '/profit/bulk-machine', title: '量贩机', icon: Wallet },
      { index: '/profit/retail-machine', title: '零售机', icon: Van }
    ]
  }
]

/** 路径所属的三级标签组（命中不了返回 null） */
export function tabGroupOf(path) {
  for (const g of tabGroups) {
    if (g.tabs.some((t) => t.index === path)) return g
  }
  return null
}

/** 侧边栏虚拟入口 index（/fm/<key>） */
export const fmEntryIndex = (g) => `/fm/${g.key}`

/** 一级分组「财务管理」——二级项：营收统计 / 成本统计 / 工资统计 / 利润统计 */
const FINANCE_MENU_TITLE = '财务管理'
const REVENUE_GROUP = tabGroups.find((g) => g.key === 'revenue')
const COST_GROUP = tabGroups.find((g) => g.key === 'cost')
const PROFIT_GROUP = tabGroups.find((g) => g.key === 'profit')
const FINANCE_ITEMS = [
  { index: fmEntryIndex(REVENUE_GROUP), title: REVENUE_GROUP.title, icon: REVENUE_GROUP.icon, to: REVENUE_GROUP.entry },
  { index: fmEntryIndex(COST_GROUP), title: COST_GROUP.title, icon: COST_GROUP.icon, to: COST_GROUP.entry },
  { index: '/salary', title: '工资统计', icon: Money },
  { index: fmEntryIndex(PROFIT_GROUP), title: PROFIT_GROUP.title, icon: PROFIT_GROUP.icon, to: PROFIT_GROUP.entry }
]

export const menuGroups = [
  { type: 'item', index: '/dashboard', title: '仪表盘', icon: HomeFilled },
  {
    type: 'group', index: '/trade', title: '进销存管理', icon: DataAnalysis,
    items: [
      { index: '/inventory', title: '库存管理', icon: Box },
      { index: '/order', title: '订单管理', icon: Document }
    ]
  },
  {
    type: 'group', index: '/statistics', title: '统计管理', icon: TrendCharts,
    items: [
      { index: '/statistics/product-sales', title: '商品销售统计', icon: DataLine }
    ]
  },
  {
    type: 'group', index: '/fm', title: FINANCE_MENU_TITLE, icon: Wallet,
    items: FINANCE_ITEMS
  },
  { type: 'item', index: '/water-tickets', title: '水站账户管理', icon: Ticket },
  {
    type: 'group', index: '/barrel', title: '回桶管理', icon: Coin,
    items: [
      { index: '/barrel/deposit', title: '押金登记', icon: Coin },
      { index: '/barrel/ledger', title: '押金台账', icon: DataAnalysis },
      { index: '/barrel/config', title: '桶型配置', icon: Box }
    ]
  },
  {
    type: 'group', index: '/base', title: '基础信息管理', icon: Folder,
    items: [
      { index: '/product', title: '商品管理', icon: Goods },
      { index: '/station', title: '水站管理', icon: Shop },
      { index: '/bulk-machine', title: '量贩机管理', icon: Shop },
      { index: '/retail-machine', title: '零售机管理', icon: Shop },
      { index: '/supplier', title: '供应商管理', icon: OfficeBuilding },
      { index: '/worker', title: '员工管理', icon: User },
      { index: '/accounts', title: '公司账户管理', icon: Wallet }
    ]
  }
]

// 财务管理一级分组的标题（面包屑用，避免 MainLayout 里再写一遍字面量）
export const FINANCE_GROUP_TITLE = FINANCE_MENU_TITLE

// path -> 标题 扁平映射（router meta.title 消费）
// 来源：① 普通菜单项（剔除 /fm/* 虚拟键） ② 三级标签组内的真实页面
export const MENU_TITLES = Object.fromEntries([
  ...menuGroups
    .flatMap((g) => (g.type === 'group' ? g.items : [g]))
    .filter((i) => !i.index.startsWith('/fm/'))
    .map((i) => [i.index, i.title]),
  ...tabGroups.flatMap((g) => g.tabs).map((t) => [t.index, t.title])
])
