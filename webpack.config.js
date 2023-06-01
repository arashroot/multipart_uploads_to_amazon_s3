const copyPlugin = require('copy-webpack-plugin')
const webpack = require('webpack')
const path = require('path')

module.exports = {
  resolve: {
    modules: [
      path.resolve('./dist/src'),
      'node_modules'
    ]
  },
  target: 'node',
  optimization: {
    nodeEnv: false
  },
  plugins: [
    new copyPlugin({
      patterns: [
        { from: 'config', to: './config' }
      ],
    }),
    new webpack.IgnorePlugin({ resourceRegExp: /^pg-native$/ })
  ]
}
