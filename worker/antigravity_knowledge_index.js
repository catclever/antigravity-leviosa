const fs = require('fs');
const path = require('path');
const { findProjectDir } = require('./project_resolver');

module.exports = async function(query) {
    const project = query.project ? decodeURIComponent(query.project) : '';
    const scope = query.scope ? decodeURIComponent(query.scope) : 'all';

    const projectDir = findProjectDir(project);
    const rules = [];

    const IGNORED_FILES = new Set(['knowledge.md', 'index.md', 'command_log.md', 'grave.md']);

    function loadRulesFromDir(dirPath, scopeLabel, forcedType = '') {
        if (!fs.existsSync(dirPath)) return;
        try {
            const files = fs.readdirSync(dirPath);
            for (const file of files) {
                if (file.endsWith('.md') && !file.startsWith('.') && !IGNORED_FILES.has(file)) {
                    const filePath = path.join(dirPath, file);
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const tag = file.replace('.md', '');
                    
                    let description = '';
                    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
                    let cleanContent = content;
                    
                    if (yamlMatch) {
                        cleanContent = content.replace(/^---\n[\s\S]*?\n---/, '').trim();
                        const yamlLines = yamlMatch[1].split('\n');
                        for (const line of yamlLines) {
                            if (line.trim().startsWith('description:')) {
                                description = line.replace('description:', '').trim().replace(/^["']|["']$/g, '');
                                break;
                            }
                        }
                    }

                    rules.push({
                        tag,
                        description,
                        content: cleanContent,
                        scope: scopeLabel,
                        type: forcedType
                    });
                }
            }
        } catch (e) {}
    }

    const globalDir = path.join(process.env.HOME, '.gemini', 'kb');

    if (['all', 'global', 'cmd-all', 'kb-all'].includes(scope)) {
        loadRulesFromDir(globalDir, 'Global');
    }
    
    if (project) {
        const subProjects = project.split(',').map(p => p.trim()).filter(Boolean);
        for (const subProject of subProjects) {
            const commandsDirName = fs.existsSync(path.join(process.env.HOME, '.gemini', 'Projects', subProject, 'commands')) ? 'commands' : 'command';
            const localCommandsDir = path.join(process.env.HOME, '.gemini', 'Projects', subProject, commandsDirName);
            const localKbDir = path.join(process.env.HOME, '.gemini', 'Projects', subProject, 'kb');
            
            // Load commands if scope is all, local, or cmd-all
            if (['all', 'local', 'cmd-all'].includes(scope)) {
                loadRulesFromDir(localCommandsDir, 'Local', 'Instruction');
            }
            
            // Load kb if scope is all, local, kb-all, or kb-local
            if (['all', 'local', 'kb-all', 'kb-local'].includes(scope)) {
                loadRulesFromDir(localKbDir, 'Local', 'Knowledge');
            }
        }
    }

    return { success: true, project: projectDir || 'none', scope, rules };
};
