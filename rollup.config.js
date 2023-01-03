import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'


export default {
  input: 'src/main.js',
  output: {
    file: 'dist/dogops.js',
  },
  plugins: [json(), commonjs(), nodeResolve()],
};
