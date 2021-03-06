#
# pushit Makefile
#


#
# Tools
#

JS_FILES	:= $(shell find lib -name '*.js')
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE   = $(JS_FILES)
JSL_FLAGS  	?= --nologo --nosummary
JSL_FLAGS_NODE 	 = --conf=$(JSL_CONF_NODE)
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS    = -o indent=4,strict-indent=1,doxygen,unparenthesized-return=0,continuation-at-front=1,leading-right-paren-ok=1



#
# test / check targets
#

.PHONY: check
check: check-jsl check-jsstyle
	@echo check ok

.PHONY: prepush
prepush: check test

#
# This rule enables other rules that use files from a git submodule to have
# those files depend on deps/module/.git and have "make" automatically check
# out the submodule as needed.
#
deps/%/.git:
	git submodule update --init deps/$*

#
# javascriptlint
#

JSL_EXEC	?= deps/javascriptlint/build/install/jsl
JSL		?= $(JSL_EXEC)

$(JSL_EXEC): | deps/javascriptlint/.git
	cd deps/javascriptlint && make install

distclean::
	if [[ -f deps/javascriptlint/Makefile ]]; then \
		cd deps/javascriptlint && make clean; \
	fi


#
# jsstyle
#

JSSTYLE_EXEC	?= deps/jsstyle/jsstyle
JSSTYLE		?= $(JSSTYLE_EXEC)

$(JSSTYLE_EXEC): | deps/jsstyle/.git

.PHONY: check-jsl
check-jsl: $(JSL_EXEC)
	@$(JSL) $(JSL_FLAGS) $(JSL_FLAGS_NODE) $(JSL_FILES_NODE)

.PHONY: check-jsstyle
check-jsstyle:  $(JSSTYLE_EXEC)
	@$(JSSTYLE) $(JSSTYLE_FLAGS) $(JSSTYLE_FILES)
