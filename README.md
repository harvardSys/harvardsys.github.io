# Harvard Systems Group

This is the website for the [Harvard Systems Group][harvard-systems]. The Harvard Systems Group at the John A. Paulson School of Engineering and Applied Sciences (SEAS) operates at the vital intersection of systems, theory, and hardware. We design and build the architectures, networks, and databases that form the backbone of modern computing.

[harvard-systems]: https://systems.seas.harvard.edu/

## Installation

To set up the website locally, follow these steps:

1. Install Hugo. Please follow the instructions on the [official Hugo installation page](https://gohugo.io/getting-started/installing/).
2. Clone this repository to your local machine:

   ```bash
   git clone https://github.com/HarvardSys/blogs-hugo.git
   ```
3. Initialize the theme submodule:

   ```bash
   cd blogs-hugo
   git submodule update --init --recursive
   ```
4. Start the Hugo server:

   ```bash
   hugo server
   ```

## Adding New Posts

To create and manage blog posts, please refer to the [New Post Guide](docs/new-post.md).

## Previewing Changes

Every branch pushed to this repository is published to a Cloudflare Worker so it
can be reviewed in a browser before merging. Pull requests get a comment linking
to their preview, which is rebuilt on every push. See the
[Preview Deployments guide](docs/preview-deployments.md) for the URLs, the
one-time setup, and how a preview differs from production.
