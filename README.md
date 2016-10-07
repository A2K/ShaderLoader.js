# ShaderLoader.js


JavaScript (EcmaScript 6 syntax), require.js compatible library for loading GLSL shaders with support for #include statements and include dependency solver.

Designed for use in browser with WebGL for loading fragment and vertex shader code.

##### Library dependencies
* underscore.js http://underscorejs.org
* jQuery https://jquery.com

##### Related projects
Khronos glslangValidator fork with `#include` syntax:
* https://github.com/A2K/glslang

Atom plugins forks with `#include` syntax:
* https://github.com/A2K/language-glsl
* https://github.com/A2K/linter-glsl
* https://github.com/A2K/atom-pigments

### #include statements

##### Basic GLSL syntax

`#include <path/to/shader/filename>`

Where filename does not include the file extension.

#### Dependencies are solved automatically

All includes will be loaded automatically using structured path names described in the end of this readme.

The dependencies resolution code traverses full tree of dependencies, orders them in order they depend on each other, and then replaces all #include statements with joined code of resolved dependencies. Files are loaded automatically when corresponding shaders requested and as dependencies (resolved automatically).

Example:

`shaders/materials/surface.glsl`:
```glsl
#include <noise/fbm>
#include <noise/noise>
void main() {
    gl_FragColor = vec4(noise(uv), 1.0);
}
```

`shaders/noise/snoise.glsl`:
```glsl
#include <noise/mod289>
float noise(vec2 xy) { ... /* code uses mod289(vec2) */ ... }
```

`shaders/noise/fbm.glsl`:
```glsl
#include <noise/noise>
float fbm(vec2 x) { ... /* code uses noise(vec2) */ ... }
```

`shaders/noise/mod289.glsl`:
```glsl
vec2 mod289(in vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
```
Becomes:
```glsl
vec2 mod289(in vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
float noise(vec2 xy) { ... /* code uses mod289(vec2) */ ... }
float fbm(vec2 x) { ... /* code uses noise(vec2) */ ... }
void main() {
    gl_FragColor = vec4(noise(uv), 1.0);
}
```

### JavaScript API

#### Usage example

```js
new ShaderLoader({
        includeSyntax: new RegExp(/^\s*#include\s*<(.*)>\s*$/),
        typePostfix: /^(vertex|fragment)$/,
        shaderFileExtention: '.glsl',
        shadersPath: 'shaders/'
    }
}).load(['materials/surface'], function(shaders, success) {
    if (!success) console.error('failed to load shaders');
    else {
        console.log('shaders/materials/surface.glsl code:', shaders.materials.surface);
    }
});
```
ShaderLoader arguments:

>__includeSyntax__: regular expression for finding #include statements

>__typePostfix__: optional postfix for parsing names like shader_frag.glsl and shader_vert.glsl

>__shaderFileExtention__: file extensions of shader files

>__shadersPath__: prefix for shader path

###### Adjustable syntax! You can `import math` or `- load utils`.


Dependencies of the requested shader will be loaded automatically. They will be ordered in order they depend on each other.

The depdendecy solver eliminates need for `#ifdef`s and `#pragma`s in every file by resolving complete dependefor duplicate inclusion prevention.

The provided shader name must be in the same format as used in #include statements (without common prefix and extension).

The `shaders` object passed to the `load()` callback is structured using following rules:

* include name is splitted into parts separated by `/` and `_` symbols

* all but last two parts joined with `/`

* last two parts joined with `_`

Example: `root/dir_subdir/shader/frag` -> `root/dir/subdir/shader_frag`

And then prefix and extension added: `shaders/root/dir/subdir/shader_frag.glsl` - this path will be requested from server (or loaded from cache).

####Limitation: no "_" underscores in directory names (file name suffixes are OK)
