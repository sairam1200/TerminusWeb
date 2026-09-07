// Package intelligence implements opt-in private-host session intelligence.
package intelligence

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

type Recommendation struct {
	ID        string `json:"id"`
	Command   string `json:"command"`
	Category  string `json:"category"`
	Purpose   string `json:"purpose"`
	Reason    string `json:"reason"`
	Risk      string `json:"risk"`
	SourceURL string `json:"sourceUrl"`
}

// Arguments are never copied to persistence or generated commands. All entries
// are reviewed non-destructive templates with primary documentation attribution.
var catalog = []Recommendation{
	{"ps-location", "Get-Location", "navigation", "Show the current directory", "Inspect your current location.", "read", "https://learn.microsoft.com/powershell/module/microsoft.powershell.management/get-location"},
	{"ps-children", "Get-ChildItem", "files", "List files and directories", "Inspect directory contents.", "read", "https://learn.microsoft.com/powershell/module/microsoft.powershell.management/get-childitem"},
	{"ps-process", "Get-Process", "system", "List running processes", "Inspect local process metadata.", "read", "https://learn.microsoft.com/powershell/module/microsoft.powershell.management/get-process"},
	{"ps-service", "Get-Service", "system", "List Windows services", "Inspect service status.", "read", "https://learn.microsoft.com/powershell/module/microsoft.powershell.management/get-service"},
	{"ps-help", "Get-Help <command>", "help", "Read command documentation", "Replace the placeholder with a command to inspect.", "read", "https://learn.microsoft.com/powershell/module/microsoft.powershell.core/get-help"},
	{"ps-command", "Get-Command", "help", "List available commands", "Discover locally installed commands.", "read", "https://learn.microsoft.com/powershell/module/microsoft.powershell.core/get-command"},
	{"git-status", "git status", "git", "Show repository working tree status", "Review changes before committing.", "read", "https://git-scm.com/docs/git-status"},
	{"git-diff", "git diff", "git", "Show unstaged changes", "Review a local diff.", "read", "https://git-scm.com/docs/git-diff"},
	{"git-log", "git log --oneline -10", "git", "Show recent commits", "Inspect recent repository history.", "read", "https://git-scm.com/docs/git-log"},
	{"git-branch", "git branch --list", "git", "List local branches", "Inspect local branch names.", "read", "https://git-scm.com/docs/git-branch"},
	{"docker-ps", "docker ps", "containers", "List running containers", "Inspect running containers without changing them.", "read", "https://docs.docker.com/reference/cli/docker/container/ls/"},
	{"docker-images", "docker images", "containers", "List container images", "Inspect local images.", "read", "https://docs.docker.com/reference/cli/docker/image/ls/"},
}

func sanitize(command string) (Recommendation, bool) {
	if len(command) == 0 || len(command) > 4096 || !utf8.ValidString(command) {
		return Recommendation{}, false
	}
	for _, r := range command {
		if unicode.IsControl(r) {
			return Recommendation{}, false
		}
	}
	words := strings.Fields(strings.ToLower(command))
	if len(words) == 0 {
		return Recommendation{}, false
	}
	// Shell metacharacters make even the apparent command uncertain.
	if !strings.ContainsAny(command, ";|&`$><(){}\"'") {
		for _, entry := range catalog {
			template := strings.Fields(strings.ToLower(entry.Command))
			if words[0] != template[0] {
				continue
			}
			if words[0] == "git" || words[0] == "docker" {
				if len(words) < 2 || words[1] != template[1] {
					continue
				}
			}
			return entry, true
		}
	}
	return Recommendation{Command: "[redacted command]", Category: "other", Purpose: "Unrecognized command; arguments removed"}, true
}

func retrieve(query string, preferred map[string]int) []Recommendation {
	query = strings.ToLower(strings.TrimSpace(query))
	out := make([]Recommendation, 0, 6)
	for pass := 0; pass < 2; pass++ {
		for _, entry := range catalog {
			if query != "" && !strings.Contains(strings.ToLower(entry.Command+" "+entry.Category+" "+entry.Purpose), query) {
				continue
			}
			if (preferred[entry.Command] > 0) != (pass == 0) {
				continue
			}
			if pass == 0 {
				entry.Reason = "A reviewed template related to your opted-in history."
			}
			out = append(out, entry)
			if len(out) == 6 {
				return out
			}
		}
	}
	return out
}
