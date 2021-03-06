/*
Copyright 2016 Bowler Hat LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
package com.nextgenactionscript.vscode.asconfig;

import java.io.File;
import java.util.Collection;
import java.util.List;

import org.apache.flex.compiler.internal.mxml.MXMLNamespaceMapping;

/**
 * Defines constants for the fields from the "compilerOptions" field of an
 * asconfig.json file, and stores the parsed values for those fields. Not all
 * available fields are used by the language server, so this should not be
 * considered a complete list.
 */
public class CompilerOptions
{
    public static final String DEBUG = "debug";
    public static final String EXTERNAL_LIBRARY_PATH = "external-library-path";
    public static final String INCLUDE_CLASSES = "include-classes";
    public static final String INCLUDE_NAMESPACES = "include-namespaces";
    public static final String INCLUDE_SOURCES = "include-sources";
    public static final String LIBRARY_PATH = "library-path";
    public static final String NAMESPACE = "namespace";
    public static final String NAMESPACE_URI = "uri";
    public static final String NAMESPACE_MANIFEST = "manifest";
    public static final String SOURCE_PATH = "source-path";
    public static final String WARNINGS = "warnings";

    public boolean debug = true;
    public Collection<File> externalLibraryPath;
    public Collection<String> includeClasses;
    public Collection<String> includeNamespaces;
    public Collection<File> includeSources;
    public Collection<File> libraryPath;
    public List<MXMLNamespaceMapping> namespaceMappings;
    public List<File> sourcePath;
    public boolean warnings = true;
}
