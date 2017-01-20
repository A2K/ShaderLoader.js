"use strict";

(function() {

var ShaderLoader = function () {

    function uniq(array) {
        return Array.from(new Set(array));
    }

    function parseFilename(filename, options) {
        var f = filename.replace(/^\s*#include\s*<(.*)>\s*$/, '$2');
        f = f.replace(new RegExp('\.' + options.shaderFileExtention + '$/'), '');
        var parts = [].concat.apply([], f.split('/').map(s => s.split('_')));
        if (parts.length > 1) {
            if (options.typePostfix.test(parts[parts.length-1])) {
                if ((parts[parts.length - 1] == 'vertex') ||
                    (parts[parts.length - 1] == 'fragment')) {
                    var last = parts[parts.length - 1];
                    parts[parts.length - 1] = parts[parts.length - 2];
                    parts[parts.length - 2] = last;
                }
            }
        }
        return parts.join('_');
    }

    class ShaderLoader {

        constructor(options) {

            options = options || {};
            options.includeSyntax = options.includeSyntax || new RegExp(/^\s*#include\s*<(.*)>\s*$/);
            options.typePostfix = options.typePostfix || /^(vertex|fragment)$/;
            options.shaderFileExtention = options.shaderFileExtention || '.glsl';
            options.shadersPath = options.shadersPath || 'shaders/';

            this.options = options;

            this.cache = {
                raw: {},
                processed: {}
            };

            this.preprocessor = new Preprocessor(this.cache, this.options);

            this.rx = {
                include: options.includeSyntax,
                path: new RegExp('^(:.*\/)?' +
                options.shadersPath.replace(new RegExp('/', 'g'), '\/') +
                '(.*)')
            };

            this.shaderCode = {
                raw: {},
                processed: {}
            };

            this.tasks = [];

        }

        load(shaders, callback) {
            shaders = shaders.map(name => {
                return parseFilename(name, this.options);
            });

            var task = new MultipleDownloadTask(this.cache, this.options);
            task.load(shaders, function (shaderCode) {
                this.processShaderCode(shaders, shaderCode, callback);
            }.bind(this));
            this.tasks.push(task);
        }

        processShaderCode(shaders, shaderCode, callback) {

            var errors = Object.keys(shaderCode).filter(key => shaderCode[key] == 'ERROR');

            if (errors.length) {
                console.error('Some shader files failed to load:', errors.join(', '));
                callback([], false);
                return;
            }

            var data = this.preprocessor.process(shaderCode, this.rx);

            if (data.missingIncludes && data.missingIncludes.length) {

                var missingShaders = data.missingIncludes.filter(a => shaders.includes(a));

                if (missingShaders.length) {
                    console.error('shader includes not found:', missingShaders.join(', '));
                    callback([], false);
                }
                else {
                    var set = new Set(data.missingIncludes);
                    shaders.forEach(set.add.bind(set));
                    this.load(Array.from(set), callback);
                }
            }
            else {
                var shaderStore = this.makeShaderStore(data.code);
                callback(shaderStore, true);
            }
        }

        makeShaderStore(preprocessedCode) {
            var res = {};

            Object.keys(preprocessedCode)
                .forEach(function (filename) {

                    var parts = filename.split('_');
                    parts.reverse();
                    var path = res;
                    while (parts.length > 1) {
                        var part = parts[parts.length -1];
                        if (!(part in path)) {
                            path[part] = {};
                        }
                        path = path[part];
                        parts.pop();
                    }
                    path[parts[0]] = preprocessedCode[filename];
                });

            res.path = function(path) {
                var obj = this;
                var p = path.split('_');
                if (p[p.length-1] == 'fragment' || p[p.length-1] == 'vertex') {
                    var t = p[p.length-2];
                    p[p.length-2] = p[p.length-1];
                    p[p.length-1] = t;
                }
                for (var i=0, path=p, len=path.length; i<len; i++){
                    obj = obj[path[i]];
                };
                return obj;
            }.bind(res);

            return res;
        }

    }

    class MultipleDownloadTask {

        constructor(cache, options) {
            this.cache = cache;
            this.options = options;
        }

        load(shaders, callback) {
            this.shaders = shaders;
            this.loaded = {};
            shaders.forEach(shader => { this.loaded[shader] = false; });
            this.callback = callback;
            shaders.forEach(function (shader) {

                if (shader in this.cache.raw) {
                    this.loaded[shader] = this.cache.raw[shader];
                } else {
                    this.loadShader(shader);
                }
            }.bind(this));
            this.checkCompletion();
        }

        checkCompletion() {
            if (Object.keys(this.shaders).map(key => {
                var n = this.shaders[key];
                return this.loaded[n] !== false;
            }).reduce((a, b) => a && b)) {
                if (this.callback) {
                    this.callback(this.loaded);
                    this.callback = null;
                }
            }
        }

        getShaderUrl(shader) {
            var parts = shader.split('_');
            if (this.options.typePostfix && parts.length > 1 && this.options.typePostfix.test(parts[parts.length - 2])) {
                parts.push(parts.pop() + '_' + parts.pop());
            }
            return this.options.shadersPath + parts.join('/') + this.options.shaderFileExtention;
        }

        loadShader(shader) {
            var url = this.getShaderUrl(shader);

            var request = new XMLHttpRequest();
            request.open("GET", url, true);
            request.responseType = "text";

            request.onload = (function(request, data, oEvent) {

                var data = request.response;

                this.cache.raw[shader] = data;
                this.loaded[shader] = data;

                this.checkCompletion();
            }.bind(this, request));

            request.onerror = () => {
                console.error('failed to load shader:', shader);
            };

            request.send();

        }

        handleError(shader) {
            this.loaded[shader] = 'ERROR';
            this.checkCompletion();
        }

    }

    class Preprocessor {
        constructor(cache, options) {
            this.cache = cache;
            this.options = options;
        }
        process(shaderCode, rx) {
            this.rx = rx.include;
            var dependencies = this.resolveDirectDependencies(shaderCode);
            var tree = this.traverseDependencyTree(shaderCode, dependencies);
            var processedCode = this.generateCode(shaderCode, tree);
            return processedCode;
        }

        resolveDirectDependencies(shaderCode) {
            var deps = {};
            for (var shaderName in shaderCode) {
                var shader = shaderCode[shaderName];
                var shaderDeps = [];
                shader.split('\n')
                    .forEach(function (line) {
                        var match = this.rx.exec(line);
                        if (match) {
                            var filename = parseFilename(match[1], this.options);
                            shaderDeps.push(filename);
                        }
                    }.bind(this));
                deps[shaderName] = shaderDeps;
            }
            return deps;
        }

        traverseDependencyTree(shaders, deps) {
            var includes = {};

            for (var shaderName in shaders) {
                var resolved = new Set();
                var queue = uniq(deps[shaderName])
                    .map(function (n) {
                        return {
                            name: n,
                            depth: 0
                        };
                    });
                var depth = {};
                var loop = 0;
                while (queue.length) {
                    var dep = queue[0];
                    if (dep.name in deps) {
                        deps[dep.name].forEach(function (d) {

                            if (!(d in depth)) {
                                depth[d] = 0;
                            }
                            depth[d] = Math.max(dep.depth + 1, depth[d]);

                            if (!resolved.has(d)) {
                                var found = false;
                                queue.forEach(function (item) {
                                    if (item.name == d) {
                                        found = true;
                                    }
                                });
                                if (!found) {
                                    queue.push({
                                        name: d,
                                        depth: dep.depth + 1
                                    });
                                }
                            }
                            if (++loop > 1000) {
                                console.error("#include loop detected:", queue.slice(0, 10), "...");
                                return;
                            }
                        });
                    }
                    if (!(dep.name in depth)) {
                        depth[dep.name] = 0;
                    }
                    depth[dep.name] = Math.max(dep.depth, depth[dep.name]);
                    resolved.add(dep.name);
                    queue.shift();
                }

                var result = Array.from(resolved);
                result.sort(function (a, b) {
                    return depth[b] - depth[a];
                });

                includes[shaderName] = result;

            }

            return includes;
        }

        removeIncludes(code) {
            return code.split('\n').filter(line => {
                    if (this.rx.exec(line)) {
                        return false;
                    }
                    return true;
                }).join('\n');
        }

        generateCode(shaderCode, includes) {

            var res = {};
            var missingIncludes = [];
            for (var shaderName in shaderCode) {
                var code = shaderCode[shaderName];

                var includesCode = includes[shaderName].map(function (include) {
                        if (!(include in shaderCode)) {
                            missingIncludes.push(include);
                        }
                        return shaderCode[include];
                    })
                    .join('\n');

                var processedCode = this.removeIncludes(includesCode + code);
                res[shaderName] = processedCode;
                this.cache.processed[shaderName] = processedCode;
            }
            return {
                code: res,
                missingIncludes: uniq(missingIncludes)
            };
        }

    }

    return ShaderLoader;
};

if (typeof(define) === 'function') {
    define('ShaderLoader', [], ShaderLoader);
} else {
    ShaderLoader = ShaderLoader();
}

}());
