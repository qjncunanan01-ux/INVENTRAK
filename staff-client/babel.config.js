module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [],
    // Reanimated 4: the worklets babel plugin ships inside babel-preset-expo
    // on SDK 57 — no manual plugin entry needed (adding one errors).
  };
};
