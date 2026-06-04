#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { findProjectDir } = require('./project_resolver');

const project = process.env.QUERY_project ? decodeURIComponent(process.env.QUERY_project) : '';
const scope = process.env.QUERY_scope ? decodeURIComponent(process.env.QUERY_scope) : 'all';

const projectDir = findProjectDir(project);

let knowledgeMdContent = '';
if (projectDir) {
    const knowledgeMdPath = path.join(projectDir, '.agent', 'knowledge.md');
    if (fs.existsSync(knowledgeMdPath)) {
        try {
            knowledgeMdContent = fs.readFileSync(knowledgeMdPath, 'utf-8');
        } catch (e) {}
    }
}

const rules = [];

function loadRulesFromDir(dirPath, scopeLabel) {
    if (!fs.existsSync(dirPath)) return;
    try {
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
            if (file.endsWith('.md')) {
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
                
                let type = '';
                if (scopeLabel === 'Local') {
                    if (knowledgeMdContent.includes(tag) || knowledgeMdContent.includes(file)) {
                        type = 'Knowledge';
                    } else {
                        type = 'Instruction';
                    }
                }

                rules.push({
                    tag,
                    description,
                    content: cleanContent,
                    scope: scopeLabel,
                    type: type
                });
            }
        }
    } catch (e) {}
}

const globalDir = path.join(process.env.HOME, '.gemini', 'kb');
let localDir = null;

if (projectDir) {
    localDir = path.join(projectDir, '.agent', 'kb');
}

if (scope === 'all' || scope === 'global') {
    loadRulesFromDir(globalDir, 'Global');
}
if (scope === 'all' || scope === 'local') {
    if (localDir) {
        loadRulesFromDir(localDir, 'Local');
    }
}

console.log(JSON.stringify({ success: true, project: projectDir || 'none', scope, rules }));
