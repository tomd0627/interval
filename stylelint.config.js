export default {
  extends: ['stylelint-config-standard'],
  plugins: ['stylelint-order'],
  rules: {
    'no-duplicate-selectors': true,
    'order/properties-alphabetical-order': true,
    'property-no-vendor-prefix': [true, { disableFix: false }],
    'value-no-vendor-prefix': [true, { disableFix: false }],
  },
};
