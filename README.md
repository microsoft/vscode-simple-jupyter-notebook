# simple-jupyter-notebook

Exploration notebook implementation for jupyter kernels.

### Usage

 1. Clone this repository, alongside built [notebook-extension-samples](https://github.com/microsoft/notebook-extension-samples)
 2. `npm install` then `npm run watch` in this repo
 3. F5. You should now be able to run cells in Jupyter notebooks, given Jupyter is installed.

If we can't find a Jupyter kernel out of the box (e.g. with some conda setup that places things in non-default paths), you can set the correct path in the `simple-jupyter.searchPaths` config key, see the [this page](https://jupyter-client.readthedocs.io/en/stable/kernels.html#kernel-specs) to get an idea of what the paths look like.

You can use the `Simple Jupyter Notebook: Change Kernel` to select among the kernels discovered on your machine, and `Restart Kernel` to restart any running kernels.
