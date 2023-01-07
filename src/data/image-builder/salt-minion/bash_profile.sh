# .bash_profile

if [ -f ~/.bashrc ]; then
	. ~/.bashrc
fi

export LC_ALL=C
export PATH=$PATH:/usr/local/bin:$HOME/.local/bin:$HOME/bin

alias ll='ls -lah --color=auto'
alias ls='ls --color=auto'
alias l.='ls -d .* --color=auto'
