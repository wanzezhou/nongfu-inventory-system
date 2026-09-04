/**
 * 侧边栏菜单配置 —— 菜单标题/图标的单一数据源（A8，2026-09-04）
 * MainLayout.vue 据此渲染菜单；router/index.js 导入 MENU_TITLES 生成 meta.title
 * （此前菜单写死在 MainLayout 模板、标题又复制一份到 router meta，双份维护易漂移）
 */
import {
  HomeFilled, Folder, Goods, Shop, OfficeBuilding, User, Avatar, Wallet,
  DataAnalysis, Box, Document, TrendCharts, DataLine, Money, Van,
  ShoppingCart, Coin, Ticket
} from '@element-plus/icons-vue'

export const menuGroups = [
  { type: 'item', index: '/dashboard', title: '仪表盘', icon: HomeFilled },
  {
    type: 'group', index: '/base', title: '基础信息管理', icon: Folder,
    items: [
      { index: '/product', title: '商品管理', icon: Goods },
      { index: '/station', title: '水站管理', icon: Shop },
      { index: '/bulk-machine', title: '量贩机管理', icon: Shop },
      { index: '/retail-machine', title: '零售机管理', icon: Shop },
      { index: '/supplier', title: '供应商管理', icon: OfficeBuilding },
      { index: '/worker', title: '员工管理', icon: User },
      { index: '/salesman', title: '业务员管理', icon: Avatar },
      { index: '/accounts', title: '公司账户管理', icon: Wallet }
    ]
  },
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
    type: 'group', index: '/finance', title: '营收统计', icon: Money,
    items: [
      { index: '/finance/platform', title: '官方平台销售', icon: Van },
      { index: '/finance/distribution', title: '直营水站销售', icon: Goods },
      { index: '/finance/retail', title: '线下零售', icon: ShoppingCart },
      { index: '/finance/bulk-machine', title: '量贩机', icon: Wallet },
      { index: '/finance/retail-machine', title: '零售机', icon: Van }
    ]
  },
  {
    type: 'group', index: '/cost', title: '成本统计', icon: Coin,
    items: [
      { index: '/cost/summary', title: '成本汇总', icon: TrendCharts },
      { index: '/cost/station', title: '直营水站成本统计', icon: OfficeBuilding },
      { index: '/cost/expenses', title: '其他支出', icon: Wallet },
      { index: '/salary', title: '工资统计', icon: Money }
    ]
  },
  { type: 'item', index: '/water-tickets', title: '水站账户管理', icon: Ticket }
]

// path -> 标题 扁平映射（router meta.title 消费）
export const MENU_TITLES = Object.fromEntries(
  menuGroups.flatMap((g) => (g.type === 'group' ? g.items : [g])).map((i) => [i.index, i.title])
)
