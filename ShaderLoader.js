"use strict";

var ShaderLoader = function ($, _) {

    function parseFilename(filename, options) {
        var f = filename.replace(/^\s*#include\s*<(.*)>\s*$/, '$2');
        f = f.replace(new RegExp('\.' + options.shaderFileExtention + '$/'), '');
        var parts = _.flatten(f.split('/').map(s => s.split('_')));
        if (parts.length > 1) {
            if (options.typePostfix.test(parts[parts.length-1])) {
                var last = parts.last;
                parts[parts.length - 1] = parts[parts.length - 2];
                parts[parts.length - 2] = last;
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

            var errors = _.keys(shaderCode).filter(key => shaderCode[key] == 'ERROR');

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
                    console.log('loading missing includes:', data.missingIncludes.join(', '));
                    this.load(_.uniq(_.union(shaders, data.missingIncludes)), callback);
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
                        var part = parts.last;
                        if (!(part in path)) {
                            path[part] = {};
                        }
                        path = path[part];
                        parts.pop();
                    }
                    path[parts[0]] = preprocessedCode[filename];
                });

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
            this.loaded = _.object(shaders, shaders.map(function() {
                return false;
            }));
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
            if (_.values(this.shaders).map(n => {
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
            $.ajax({
                url: url,
                dataType: 'text',
                context: {
                    shader: shader
                },
                complete: function (args) {
                    if (args.responseText) {
                        this.cache.raw[shader] = args.responseText;
                        this.loaded[shader] = args.responseText;
                    }
                    this.checkCompletion();
                }.bind(this),
                error: function () {
                    this.handleError(shader);
                }.bind(this)
            });
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
                var queue = _.uniq(deps[shaderName])
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
            return _.filter(code.split('\n'), (line => {
                    if (this.rx.exec(line)) {
                        return false;
                    }
                    return true;
                }).bind(this))
                .join('\n');
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
                missingIncludes: _.uniq(missingIncludes)
            };
        }

    }

    return ShaderLoader;
};

if (typeof(define) != undefined) {
    define(['jquery', 'underscore'], ShaderLoader);
} else {
    ShaderLoader = ShaderLoader();
}
