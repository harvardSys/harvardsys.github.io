# Post Checklist

This checklist is meant to be used before publishing a post. It ensures that the post meets certain quality and formatting standards.

- [ ] **Content quality**: Check that there are no TODOs, placeholders, typos or grammar mistakes.
- [ ] **Title**: Ensure `title` field in front matter is the desired title.
- [ ] **Author**: Set the `author` field to your full name. For the full author card (photo, title, links), match the spelling of your entry in `data/people.yaml`.
- [ ] **Date** - Set `date` to current or past date (future dates won't render). The format should be `YYYY-MM-DDTHH:MM:SS±HH:MM`.
- [ ] **Draft is false**: Change `draft = true` to `draft = false` before publishing.
- [ ] **Tags are relevant**: Add appropriate tags using `tags = ['tag1', 'tag2']` format.
- [ ] **Summary**: Either add a `summary` field in the front matter or use `<!--more-->` to indicate the summary break. For example:
   ```markdown
   +++
   ...
   summary = "This is a brief summary of the post."
   +++
   ```
   or
   ```markdown
   The content of the post goes here.

   <!--more-->
   ```

   See [Hugo's summary documentation](https://gohugo.io/content-management/summaries/) for more details.
- [ ] **Images properly referenced**: Check all image paths and alt text are correct. Use preferred formats (SVG for diagrams, WebP for photos). File sizes should be optimized. A missing image now prints a `figure image ... not found` warning during the build.
- [ ] **Figures readable on phone and laptop**: View the post at ~390px wide (browser device toolbar) and at laptop width. Text in every figure should be readable on the phone without zooming, nothing should scroll sideways, and on a laptop figure text should not be much larger than body text. See the [Figures guide](figures.md) for `size`, `panels`, and code-built `{{< diagram >}}` figures.
- [ ] **Links**: Check that all URLs are accessible and correct.
- [ ] **Enable Table of Contents if the post is long**: If the post is long, consider adding `showToc = true` in the front matter to enable a table of contents.
- [ ] **No build errors**: Ensure no Hugo build warnings or errors.
