// Чиним webpack 5 + ESM .mjs из @pixi/react v8:
// отключаем "fullySpecified" для .mjs, чтобы импорты без расширений
// (например, 'react-reconciler/constants') резолвились корректно.
module.exports = function override(config) {
  config.module.rules.push({
    test: /\.m?js$/,
    resolve: { fullySpecified: false },
  });
  return config;
};
