import {adaptive, defineTheme} from '@hzblj/kara-ui'

/** An indigo accent: every accent token is set in one place, and the Android seed moves with them. */
export const theme = defineTheme({
  colors: {
    border: {accent: '#3d5afe'},
    content: {accent: adaptive({dark: '#8c9eff', light: '#304ffe'})},
    fill: {
      accent: {
        base: adaptive({dark: '#3d5afe33', light: '#e8eaff'}),
        disabled: adaptive({dark: '#3d5afe1f', light: '#c5cbff'}),
        primary: '#3d5afe',
      },
    },
    shadow: {btn: {accent: {ring: adaptive({dark: '#3d5afe00', light: '#b8c1ff'})}}},
  },
  materialSeed: '#3d5afe',
})
