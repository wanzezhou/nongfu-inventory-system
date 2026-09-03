// echarts 按需引入：全项目仅 Dashboard.vue（折线/饼图）与 ProductSales.vue（柱状图）使用，
// 此处集中注册实际用到的图表、组件与渲染器，替代全量 `import * as echarts from 'echarts'`
// （echarts/core 自带 graphic 命名空间，LinearGradient 写法保持不变）
import * as echarts from 'echarts/core'
import { LineChart, PieChart, BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([LineChart, PieChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

export default echarts
