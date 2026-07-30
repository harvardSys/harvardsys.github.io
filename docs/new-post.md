# Add New Blog Posts

## Use Your Own Branch

To add a new blog post, it is recommended to create a new branch from the `master` branch.

## Create a Template

Hugo provides a simple way to create new blog posts using templates.

Blog posts live in the `blog/` section (`content/blog/`). Depending on the content, if you
1. want to create a blog post with figures, it is recommended to use: (replace `[post-name]` with your desired post name)

   ```bash
   hugo new content blog/[post-name]/index.md
   ```
2. want to create a blog post without any supplementary files, you can use: (replace `[post-name]` with your desired post name)

   ```bash
   hugo new blog/[post-name].md
   ```

In both cases, a markdown file will be created and include some metadata in the front matter.

For example, if I run `hugo new content blog/first-post/index.md`, the file `content/blog/first-post/index.md` will be created with the following content:

```markdown
+++
date = '2026-01-01T23:39:42-08:00'
draft = true
title = 'First Post'
+++
```

## Start Editing

After creating the post, you can start editing the post.

Follow the following guide:

1. Add tags so that your post can be categorized. In the front matter, add a `tags` field as follows:

   ```markdown
   +++
   ...
   tags = ['tag1', 'tag2']
   +++
   ```
2. (Optional) change the `date` and `title` fields to your desired values.

   **Note: hugo will skip rendering posts with `date` set in the future.** So make sure to set the `date` field to the current date or a past date if you want to view the post.
3. Set the author. Add an `author` field to the front matter with your full name:

   ```markdown
   +++
   ...
   author = 'Your Full Name'
   +++
   ```

   The author name is shown in the byline below the title, and an author card is rendered at the end of the post. If the name exactly matches an entry in `data/people.yaml`, the card automatically pulls in that person's photo, title, website, and email; otherwise it shows the name only. To get the richer card, use the same spelling as your entry in `data/people.yaml` (add yourself there first if you are not listed).
4. (Optional) Add a short author bio, shown in the author card at the end of the post:

   ```markdown
   +++
   ...
   bio = 'One or two sentences about yourself.'
   +++
   ```

   If omitted, the card falls back to the `bio` field of your entry in `data/people.yaml` (if present); a `bio` in the post front matter overrides the one in `data/people.yaml`. Inline markdown (links, emphasis) is supported.
5. (Optional) Add a TL;DR, rendered in a highlighted box at the top of the post, before the table of contents:

   ```markdown
   +++
   ...
   tldr = 'A few sentences summarizing the key takeaways of the post.'
   +++
   ```

   Inline markdown is supported here as well.
6. If you want to view the post before publishing, run hugo server with `--buildDrafts` flag:

   ```bash
   hugo server --buildDrafts
   ```

   After running the command, the hugo server will be started, All saved modifications will be monitored and reflected immediately and automatically. You can view the post at `http://localhost:1313/blog/[post-name]/`.
   
   > Note: If you don't want to view draft posts, you can simply run `hugo server` without the `--buildDrafts` flag.
7. Start writing your content in markdown format below the front matter.

   For figures, it is recommended to place them in the same directory as the markdown file. Svg (for diagrams) and webp (for photos) are preferred formats. You can reference the figures in markdown as follows:

   ```markdown
    ![Alt text](figure-name.webp "title")
    ```
8. Once you are satisfied with the post, do the [post checklist](post-checklist.md). After completing the checklist, change the `draft` field to `false` in the front matter:

   ```markdown
   +++
   draft = false
   +++
   ```

## Publishing Your Post

After setting `draft` to `false`, you may create a pull request to merge your post into the `master` branch. Once the pull request is reviewed and approved, the post will be published on the website.
