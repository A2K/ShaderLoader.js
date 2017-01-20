
define(['three', 'ShaderLoader'], (THREE, ShaderLoader) => {

    var shaderLoader = new ShaderLoader();

    class Material extends THREE.ShaderMaterial {

        constructor(options) {
	    options = options || {};
            if (!options.fragmentShader) {
                console.error('no fragment shader name provided');
                return;
            }
            var fragmentShaderName = options.fragmentShader;
            var vertexShaderName = options.vertexShader || 'generic_vertex';
            delete options.fragmentShader;
            delete options.vertexShader;
            super(options);
            this.fragmentShaderName = fragmentShaderName;
            this.vertexShaderName = vertexShaderName;
            this.reload();
        }

        reload() {
            shaderLoader.load([this.fragmentShaderName, this.vertexShaderName], ((shaders) => {
                this.fragmentShader = shaders.path(this.fragmentShaderName);
                this.vertexShader = shaders.path(this.vertexShaderName);
                this.needsUpdate = true;
            }).bind(this));
        }

    };

    return Material;

});
