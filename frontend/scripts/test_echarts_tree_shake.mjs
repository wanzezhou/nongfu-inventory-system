// echarts 按需引入功能冒烟：用 utils/echarts.js 的按需注册实例做 SSR 渲染，
// 若 Line/Pie/Bar 图表或 Grid/Tooltip/Legend 组件未注册，渲染结果会缺元素或报 "Unknown series"
import echarts from '../src/utils/echarts.js'
import { SVGRenderer } from 'echarts/renderers'

echarts.use([SVGRenderer]) // 仅测试用：node 无 canvas，SSR 走 SVG

const chart = echarts.init(null, null, { ssr: true, width: 400, height: 300, renderer: 'svg' })
let failed = 0

const render = (name, option, expect) => {
  chart.setOption(option, true)
  const svg = chart.renderToSVGString()
  const ok = expect.every((kw) => svg.includes(kw))
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} (svg ${svg.length} bytes${ok ? '' : ', 缺少: ' + expect.filter((k) => !svg.includes(k)) + ')'}`)
  if (!ok) failed++
}

render('折线图+渐变面积', {
  xAxis: { type: 'category', data: ['周一', '周二'] },
  yAxis: { type: 'value' },
  series: [{ type: 'line', smooth: true, data: [10, 20], areaStyle: {} }]
}, ['path', 'stroke'])

render('饼图+图例', {
  legend: { right: '5%' },
  series: [{ type: 'pie', radius: ['45%', '70%'], data: [{ name: 'A', value: 1 }, { name: 'B', value: 2 }] }]
}, ['path', 'legend'])

render('柱状图', {
  xAxis: { type: 'category', data: ['A', 'B'] },
  yAxis: { type: 'value' },
  series: [{ type: 'bar', barWidth: 16, data: [5, 8] }]
}, ['rect'])

// 未注册图表应不渲染（验证按需裁剪生效，无实现泄漏进来）
const warnings = []
const origError = console.error
console.error = (...args) => { warnings.push(args.join(' ')) }
chart.setOption({ series: [{ type: 'sankey', data: [], links: [] }] }, true)
const svgSankey = chart.renderToSVGString()
console.error = origError
const sankeyBlocked = warnings.some((w) => w.includes('Series sankey is used but not imported')) && !svgSankey.includes('<path')
console.log(`${sankeyBlocked ? 'PASS' : 'FAIL'} 未注册的 sankey 被拦截且无实现渲染 (svg ${svgSankey.length} bytes, 警告 ${warnings.length} 条)`)

console.log(failed === 0 && sankeyBlocked ? '\n全部通过：按需注册完整且裁剪生效' : `\n存在 ${failed} 项失败`)
process.exit(failed === 0 && sankeyBlocked ? 0 : 1)
