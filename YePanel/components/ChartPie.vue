<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { type PropType, useDark, useECharts } from "@pureadmin/utils";

const props = defineProps({
  chartData: {
    type: Array as PropType<{ value: string | number; name: string }[]>,
    required: true,
  },
  loading: {
    type: Boolean,
  },
});

// 兼容dark主题
const { isDark } = useDark();
let theme = computed(() => {
  return isDark.value ? "dark" : "default";
});

// 初始化ECharts
const chartRef = ref();
const { setOptions } = useECharts(chartRef, { theme });

// watch(
//   () => props.loading,
//   async () => {
//     await nextTick(); // 确保DOM更新完成后再执行
    setOptions({
      tooltip: {
        trigger: "item",
        position: function (point, params, dom, rect, size) {
          const x = point[0];
          const chartWidth = size.viewSize[0];
          if (x < chartWidth / 2) {
            return [x + 20, point[1]];
          } else {
            if (dom instanceof HTMLDivElement) {
              return [x - dom.offsetWidth - 20, point[1]];
            } else {
              return [x - 100, point[1]];
            }
          }
        },
        formatter: "{b}<br/>{c}次 ({d}%)",
      },
      series: [
        {
          name: "调用统计",
          type: "pie",
          roseType: "area",
          radius: ["20%", "70%"],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 10,
            borderColor: "#fff",
            borderWidth: 2,
          },
          data: props.chartData,
          label: {
            formatter: function (params) {
              const reg = /^(.+)\((.+)\)$/;
              if (reg.test(params.name)) {
                const [, name, fun] = params.name.match(/^(.+)\((.+)\)$/);
                return `${name}\n${fun}`;
              } else {
                return params.name;
              }
            },
          },
          labelLine: {
            length: 5, // 指引线的长度
            length2: 5, // 第二段线的长度
            minTurnAngle: 30, // 强制线条转向一定角度
            smooth: true, // 平滑的指引线
          },
        },
      ],
    });
//   }
// );
</script>

<template>
  <div ref="chartRef" style="width: 100%; height: 370px" />
</template>
