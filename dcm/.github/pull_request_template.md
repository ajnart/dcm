<div align="center">
  <img src="https://github.com/ajnart/dcm/blob/main/public/favicon.png?raw=true" height="80" alt="DCM Logo" />
  <h3>Docker Compose Maker</h3>
</div>

<!-- 
Specific templates are available for different types of contributions:
- For adding a new container: https://github.com/ajnart/dcm/compare/main...main?template=new_container.md
- For bug fixes: https://github.com/ajnart/dcm/compare/main...main?template=bugfix.md
- For new features: https://github.com/ajnart/dcm/compare/main...main?template=feature.md
-->

### Type of Change
<!-- Please select the type of changes this PR introduces -->

- [ ] 📦 New Container Definition
- [ ] 🐛 Bug Fix
- [ ] ✨ New Feature
- [ ] 📝 Documentation Update
- [ ] 🎨 UI/Style Improvement
- [ ] ♻️ Code Refactoring
- [ ] 🔧 Configuration Changes
- [ ] 🚀 Performance Improvement
- [ ] ⚙️ CI/Build Changes
- [ ] 🔥 Breaking Change
- [ ] 🧪 Test

### Description
<!-- Please describe your changes here -->

### Checklist

**Thank you for your contribution. Please ensure that your pull request meets the following requirements:**

- [ ] PR targets the `main` branch
- [ ] Code builds without warnings or errors (`npm run build` or `yarn build` or `pnpm build`)
- [ ] Commits follow the [conventional commits guideline](https://www.conventionalcommits.org/en/v1.0.0/)
- [ ] No shorthand variable names are used (e.g., `x`, `y`, `i` or any abbreviation outside common conventions)
- [ ] Tests have been added for new functionality (if applicable)

**For container definitions:**
- [ ] Container image is actively maintained
- [ ] Docker Compose definition uses provided environment variables (e.g., `${PUID}`, `${CONFIG_PATH}`)
- [ ] Docker Compose definition has been tested
- [ ] Container has been added to the appropriate category file and indexed in `tools/index.ts`

This PR is in accordance with the [CONTRIBUTING.md](https://github.com/ajnart/dcm/blob/main/CONTRIBUTING.md) guidelines. 